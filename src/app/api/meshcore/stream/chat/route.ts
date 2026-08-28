import { NextRequest } from 'next/server';
import { createChatMessagesStreamerConfig } from '@/lib/clickhouse/streaming';
import { subscribeToStream } from '@/lib/clickhouse/stream-cache';
import { decryptMeshcoreGroupMessage } from '@/lib/meshcore';

export async function GET(req: NextRequest) {
  // TEMPORARILY_DISABLED: chat stream API is turned off. Delete this block to re-enable.
  const encoder = new TextEncoder();
  const disabledPayload = encoder.encode(
    `event: error\ndata: ${JSON.stringify({ type: "error", message: "Chat stream temporarily disabled", timestamp: new Date().toISOString() })}\n\n`,
  );
  return new Response(disabledPayload, {
    status: 503,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
      "Access-Control-Allow-Methods": "GET",
    },
  });

  const { searchParams } = new URL(req.url);
  
  // Get and validate input parameters
  const channelId = searchParams.get('channel_id');
  const region = searchParams.get('region');
  const decrypt = searchParams.has('decrypt');
  const privateKeys = searchParams.getAll('privateKeys');
  const pollInterval = searchParams.get('pollInterval');
  const maxRows = searchParams.get('maxRows');
  const skipInitialMessages = searchParams.has('skipInitialMessages');
  const firstTimestamp = searchParams.get('firstTimestamp') ?? searchParams.get('lastTimestamp');

  // Validate region against allowed values (same as packets endpoint)
  const allowedRegions = ['krasnodar_pub', 'stavropol'];
  const validRegion = region && allowedRegions.includes(region) ? region : undefined;

  // Validate channel ID (should be hex string if provided)
  let validChannelId: string | undefined;
  if (channelId && /^[0-9A-Fa-f]+$/.test(channelId)) {
    validChannelId = channelId.toLowerCase();
  } else if (channelId) {
    // If channelId is provided but not valid hex, return error
    return new Response(JSON.stringify({ error: 'Invalid channel_id format. Must be a hex string.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate poll interval (100ms to 10s, default 1s for chat)
  const validPollInterval = Math.max(100, Math.min(10000, parseInt(pollInterval || '1000', 10)));

  // Validate max rows (10 to 1000, default 500 for chat)
  const validMaxRows = Math.max(10, Math.min(1000, parseInt(maxRows || '500', 10)));

  // Prepare decryption keys if decryption is requested
  let allKeys: string[] = [];
  if (decrypt) {
    const PUBLIC_MESHCORE_KEY = "izOH6cXN6mrJ5e26oRXNcg==";
    allKeys = [PUBLIC_MESHCORE_KEY, ...privateKeys];
  }

  // Create streaming configuration with validated parameters
  const config = createChatMessagesStreamerConfig(validChannelId, validRegion);
  
  // Override config with validated values
  config.pollInterval = validPollInterval;
  config.maxRowsPerPoll = validMaxRows;
  config.skipInitialMessages = skipInitialMessages;

  // Build parameters object with validated values
  const params: Record<string, any> = {};
  if (validChannelId) params.channelId = validChannelId;
  
  const encoder = new TextEncoder();
  
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        unsubscribe = subscribeToStream(config, params, async (result) => {
          // Check for errors in the result
          if ('error' in result && result.error) {
            const errorData = JSON.stringify({
              type: 'error',
              message: result.error,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
            return;
          }

          let outputData = result.row;

          if (decrypt && allKeys.length > 0) {
            try {
              const decrypted = await decryptMeshcoreGroupMessage({
                encrypted_message: result.row.encrypted_message,
                mac: result.row.mac,
                channel_hash: result.row.channel_hash,
                knownKeys: allKeys,
                parse: true
              });
              
              if (decrypted) {
                outputData = {
                  ...result.row,
                  decrypted
                };
              }
            } catch (error) {
              console.warn("Failed to decrypt streaming message:", error);
            }
          }

          const data = JSON.stringify(outputData);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }, { startAfter: firstTimestamp ?? null });
      } catch (error) {
        console.error('Meshcore chat streaming error:', error);
        const errorData = JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });

        controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
        controller.close();
      }
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'Access-Control-Allow-Methods': 'GET'
    }
  });
}



