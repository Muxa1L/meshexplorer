import { NextRequest } from 'next/server';
import { createMeshcorePacketsStreamerConfig } from '@/lib/clickhouse/streaming';
import { subscribeToStream } from '@/lib/clickhouse/stream-cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  
  // Validate and sanitize input parameters
  const region = searchParams.get('region');
  const payloadType = searchParams.get('payloadType');
  const routeType = searchParams.get('routeType');
  const originPubkey = searchParams.get('originPubkey');
  const pollInterval = searchParams.get('pollInterval');
  const maxRows = searchParams.get('maxRows');
  const skipInitialMessages = searchParams.has('skipInitialMessages');
  const firstTimestamp = searchParams.get('firstTimestamp') ?? searchParams.get('lastTimestamp');

  // Validate region against allowed values
  const allowedRegions = ['krasnodar_pub', 'stavropol']; // Add more allowed regions as needed  
  const validRegion = region && allowedRegions.includes(region) ? region : undefined;

  // Validate payload type (0-15 based on the schema)
  let validPayloadType: number | undefined;
  if (payloadType) {
    const parsed = parseInt(payloadType, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 15) {
      validPayloadType = parsed;
    }
  }

  // Validate route type (0-3 based on the schema)
  let validRouteType: number | undefined;
  if (routeType) {
    const parsed = parseInt(routeType, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
      validRouteType = parsed;
    }
  }

  // Validate origin pubkey (should be hex string)
  let validOriginPubkey: string | undefined;
  if (originPubkey && /^[0-9A-Fa-f]+$/.test(originPubkey)) {
    validOriginPubkey = originPubkey.toUpperCase();
  }

  // Validate poll interval (100ms to 10s)
  const validPollInterval = Math.max(100, Math.min(10000, parseInt(pollInterval || '500', 10)));

  // Validate max rows (10 to 10000)
  const validMaxRows = Math.max(10, Math.min(10000, parseInt(maxRows || '10', 10)));

  // Create streaming configuration with validated parameters
  const config = createMeshcorePacketsStreamerConfig(
    validRegion,
    validPayloadType,
    validRouteType,
    validOriginPubkey
  );
  
  // Override config with validated values
  config.pollInterval = validPollInterval;
  config.maxRowsPerPoll = validMaxRows;
  config.skipInitialMessages = skipInitialMessages;

  // Build parameters object with validated values
  const params: Record<string, any> = {};
  if (validPayloadType !== undefined) params.payloadType = validPayloadType;
  if (validRouteType !== undefined) params.routeType = validRouteType;
  if (validOriginPubkey) params.originPubkey = validOriginPubkey;
  
  const encoder = new TextEncoder();
  
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        unsubscribe = subscribeToStream(config, params, async (result) => {
          if ('error' in result && result.error) {
            const errorData = JSON.stringify({
              type: 'error',
              message: result.error,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
            return;
          }

          const data = JSON.stringify(result.row);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }, { startAfter: firstTimestamp ?? null });      } catch (error) {
        console.error('Meshcore packets streaming error:', error);
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
