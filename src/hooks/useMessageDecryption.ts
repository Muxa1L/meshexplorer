import { useQuery } from '@tanstack/react-query';
import { decryptMeshcoreGroupMessage, decryptMeshcoreGroupPayload, hexToBytes } from '@/lib/meshcore';
import { useMemo } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { ensureMcoImgBrowserLoaded } from '@/lib/mcoimg';

export interface MessageDecryptionParams {
  encrypted_message: string;
  mac: string;
  channel_hash: string;
  knownKeys: string[];
  payload_type?: number;
  parse?: boolean;
}

export interface DecryptedTextMessage {
  kind: 'text';
  timestamp: number;
  msgType: number;
  sender: string;
  text: string;
  rawText: string;
}

export interface DecryptedMcoImageMessage {
  kind: 'mcoimg';
  sender: string;
  payload: Uint8Array;
  width?: number;
  height?: number;
}

export type DecryptedMessage = DecryptedTextMessage | DecryptedMcoImageMessage;

export interface MessageDecryptionResult {
  decrypted: DecryptedMessage | null;
  error: string | null;
}

interface UseMessageDecryptionParams extends MessageDecryptionParams {
  enabled?: boolean;
}

async function tryParseMcoImagePayload(candidateBytes: Uint8Array): Promise<DecryptedMcoImageMessage | null> {
  const runtime = await ensureMcoImgBrowserLoaded();

  if (typeof runtime.inspectMcoImageChannelPacket !== 'function') {
    return null;
  }

  const packet = runtime.inspectMcoImageChannelPacket(candidateBytes, {
    dataType: 0x0120,
    formatVersion: 3,
    validate: true,
  });

  if (!packet?.payload) {
    return null;
  }

  const inspected = runtime.inspectPayload(packet.payload);

  return {
    kind: 'mcoimg',
    sender: packet.senderName ?? '',
    payload: packet.payload,
    width: inspected?.width,
    height: inspected?.height,
  };
}

export function useMessageDecryption({
  encrypted_message,
  mac,
  channel_hash,
  knownKeys,
  payload_type = 5,
  parse = true,
  enabled = true
}: UseMessageDecryptionParams) {
  const { locale, t } = useLocale();

  // Stabilize the known keys to prevent unnecessary re-renders
  const knownKeysString = useMemo(() => knownKeys.join(','), [knownKeys]);

  return useQuery<MessageDecryptionResult, Error>({
    queryKey: ['message-decryption', locale, encrypted_message, mac, channel_hash, payload_type, knownKeysString, parse],
    queryFn: async (): Promise<MessageDecryptionResult> => {
      try {
        if (payload_type === 6) {
          const decryptedBytes = await decryptMeshcoreGroupPayload({
            encrypted_message,
            mac,
            channel_hash,
            knownKeys,
          });

          const candidates: Uint8Array[] = [];
          if (decryptedBytes) {
            candidates.push(decryptedBytes);
          }
          candidates.push(hexToBytes(encrypted_message));

          for (const candidate of candidates) {
            try {
              const parsedMcoImage = await tryParseMcoImagePayload(candidate);
              if (parsedMcoImage) {
                return {
                  decrypted: parsedMcoImage,
                  error: null,
                };
              }
            } catch {
              continue;
            }
          }

          return {
            decrypted: null,
            error: t('chatMessage.decryptFailed'),
          };
        }

        const result = await decryptMeshcoreGroupMessage({
          encrypted_message,
          mac,
          channel_hash,
          knownKeys,
          parse,
        });

        if (result === null) {
          return {
            decrypted: null,
            error: t("chatMessage.decryptFailed")
          };
        }

        return {
          decrypted: {
            ...(result as DecryptedTextMessage),
            kind: 'text',
          },
          error: null
        };
      } catch (err) {
        return {
          decrypted: null,
          error: err instanceof Error ? err.message : t("chatMessage.decryptError")
        };
      }
    },
    enabled: enabled && !!encrypted_message && !!mac && !!channel_hash && knownKeys.length > 0,
    staleTime: Infinity, // Never consider decrypted messages stale
    gcTime: Infinity, // Never garbage collect decrypted messages
    retry: false, // Don't retry decryption failures
    refetchOnWindowFocus: false, // Don't refetch on focus - decryption is deterministic
    refetchOnMount: false, // Don't refetch on mount if we have cached data
    refetchOnReconnect: false, // Don't refetch on network reconnect
  });
}
