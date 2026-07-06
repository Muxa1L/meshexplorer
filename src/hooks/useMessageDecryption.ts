import { useQuery } from '@tanstack/react-query';
import { decryptMeshcoreGroupMessage, decryptMeshcoreGroupPayloadCandidates, diagnoseMeshcoreGroupDecryptFailure, hexToBytes } from '@/lib/meshcore';
import { useMemo } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { ensureMcoImgBrowserLoaded, isMcoImagePayload } from '@/lib/mcoimg';

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

const MCO_ADVANCED_APP_DATA_TYPE = 0x0120;
const LEGACY_MCO_IMAGE_DATA_TYPE = 0xfff0;
const LEGACY_MCO_IMAGE_TEXT_DATA_TYPE = 0xfff1;

interface MeshcoreGroupDataEnvelope {
  dataType: number;
  payload: Uint8Array;
  offset: number;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function parseMeshcoreGroupDataEnvelope(bytes: Uint8Array, offset = 0): MeshcoreGroupDataEnvelope | null {
  if (offset < 0 || bytes.length - offset < 3) {
    return null;
  }

  const dataType = readUint16LE(bytes, offset);
  const dataLength = bytes[offset + 2];
  const payloadStart = offset + 3;
  const remaining = bytes.length - payloadStart;

  if (dataLength > remaining) {
    return null;
  }

  return {
    dataType,
    payload: bytes.slice(payloadStart, payloadStart + dataLength),
    offset,
  };
}

interface LegacyChannelBinaryEnvelope {
  senderName: string;
  body: Uint8Array;
}

function parseVarUint(bytes: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;

    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: cursor };
    }

    shift += 7;
    if (shift > 28) {
      return null;
    }
  }

  return null;
}

function parseLegacyChannelBinaryEnvelope(bytes: Uint8Array): LegacyChannelBinaryEnvelope | null {
  const lengthInfo = parseVarUint(bytes, 0);
  if (!lengthInfo) {
    return null;
  }

  const senderEnd = lengthInfo.nextOffset + lengthInfo.value;
  if (senderEnd > bytes.length) {
    return null;
  }

  let senderName = 'Unknown';
  try {
    senderName = new TextDecoder().decode(bytes.slice(lengthInfo.nextOffset, senderEnd)) || 'Unknown';
  } catch {
    senderName = 'Unknown';
  }

  return {
    senderName,
    body: bytes.slice(senderEnd),
  };
}

async function tryParseMcoImagePayload(candidateBytes: Uint8Array): Promise<DecryptedMcoImageMessage | null> {
  const runtime = await ensureMcoImgBrowserLoaded();

  const verifiedPayloads: Uint8Array[] = [];

  function buildRawPayloadCandidates(bytes: Uint8Array): Uint8Array[] {
    const candidates: Uint8Array[] = [bytes];

    if (bytes.length > 4) {
      candidates.push(bytes.slice(4));
    }

    for (const source of [...candidates]) {
      for (let index = 0; index < source.length; index += 1) {
        if (source[index] === 0x13 && index + 2 < source.length) {
          candidates.push(source.slice(index));
        }
      }
    }

    return candidates;
  }

  async function addVerifiedPayload(payload: Uint8Array | null | undefined, sender = ''): Promise<DecryptedMcoImageMessage | null> {
    if (!payload || payload.length === 0) {
      return null;
    }

    const alreadySeen = verifiedPayloads.some((existing) =>
      existing.length === payload.length && existing.every((value, index) => value === payload[index]),
    );
    if (alreadySeen) {
      return null;
    }

    try {
      await runtime.convertPayload(payload, {
        input: 'binary',
        output: 'png',
      });

      verifiedPayloads.push(payload);
      const inspected = runtime.inspectPayload(payload);

      return {
        kind: 'mcoimg',
        sender,
        payload,
        width: inspected?.width,
        height: inspected?.height,
      };
    } catch {
      return null;
    }
  }

  const rawPayloadCandidates = buildRawPayloadCandidates(candidateBytes);

  if (typeof runtime.inspectMcoImageChannelPacket === 'function') {
    const packetOptions = [
      { layout: 'envelope' as const, dataType: 0x0120, formatVersion: 3, validate: false },
      { dataType: 0x0120, formatVersion: 3, validate: true },
      { dataType: 0x0120, formatVersion: 3, validate: false },
      { layout: 'channelData' as const, dataType: 0x0120, formatVersion: 3, validate: false },
      { layout: 'outgoingCommand' as const, dataType: 0x0120, formatVersion: 3, validate: false },
      { layout: 'rawMcoImage' as const, validate: false },
    ];

    for (const bytes of rawPayloadCandidates) {
      for (const options of packetOptions) {
        try {
          const packet = runtime.inspectMcoImageChannelPacket(bytes, options);
          const verified = await addVerifiedPayload(packet?.payload, packet?.senderName ?? '');
          if (verified) {
            return verified;
          }
        } catch {
          continue;
        }
      }
    }
  }

  const directPayloadCandidates: Uint8Array[] = [];

  for (const bytes of rawPayloadCandidates) {
    directPayloadCandidates.push(bytes);

    if (bytes[0] !== 0x13) {
      const canonicalPayload = new Uint8Array(bytes.length + 1);
      canonicalPayload[0] = 0x13;
      canonicalPayload.set(bytes, 1);
      directPayloadCandidates.push(canonicalPayload);
    }
  }

  for (const payload of directPayloadCandidates) {
    const verified = await addVerifiedPayload(payload, '');
    if (verified) {
      return verified;
    }
  }

  if (typeof runtime.extractMcoImagePayload === 'function') {
    for (const bytes of rawPayloadCandidates) {
      try {
        const extracted = runtime.extractMcoImagePayload(bytes, {
          layout: 'envelope',
          dataType: 0x0120,
          formatVersion: 3,
          validate: false,
        });
        const verified = await addVerifiedPayload(extracted, '');
        if (verified) {
          return verified;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function tryParseMcoImageTextPayload(candidateBytes: Uint8Array): Promise<string | null> {
  const runtime = await ensureMcoImgBrowserLoaded();

  if (typeof runtime.payloadToText !== 'function') {
    return null;
  }

  try {
    const text = runtime.payloadToText(candidateBytes).trim();
    return isMcoImagePayload(text) ? text : null;
  } catch {
    return null;
  }
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

  function buildSyntheticTextMessage(text: string, sender = ''): DecryptedTextMessage {
    return {
      kind: 'text',
      timestamp: 0,
      msgType: payload_type,
      sender,
      text,
      rawText: text,
    };
  }

  return useQuery<MessageDecryptionResult, Error>({
    queryKey: ['message-decryption', locale, encrypted_message, mac, channel_hash, payload_type, knownKeysString, parse],
    queryFn: async (): Promise<MessageDecryptionResult> => {
      try {
        if (payload_type === 6) {
          const decryptedPayloadCandidates = await decryptMeshcoreGroupPayloadCandidates({
            encrypted_message,
            mac,
            channel_hash,
            knownKeys,
            trimTrailingZeros: false,
          });

          const candidates: Uint8Array[] = [];
          for (const decryptedBytes of decryptedPayloadCandidates) {
            candidates.push(decryptedBytes);

            let trimmedEnd = decryptedBytes.length;
            while (trimmedEnd > 0 && decryptedBytes[trimmedEnd - 1] === 0) {
              trimmedEnd -= 1;
            }

            if (trimmedEnd > 0 && trimmedEnd < decryptedBytes.length) {
              candidates.push(decryptedBytes.slice(0, trimmedEnd));
            }
          }
          candidates.push(hexToBytes(encrypted_message));

          const structuredDataTypes = new Set<string>();
          let sawStructuredEnvelope = false;

          for (const candidate of candidates) {
            const envelopes = [
              parseMeshcoreGroupDataEnvelope(candidate, 0),
              parseMeshcoreGroupDataEnvelope(candidate, 4),
            ].filter((value): value is MeshcoreGroupDataEnvelope => value !== null);

            if (envelopes.length > 0) {
              sawStructuredEnvelope = true;

              for (const envelope of envelopes) {
                structuredDataTypes.add(`0x${envelope.dataType.toString(16).padStart(4, '0')}`);

                try {
                  if (envelope.dataType === LEGACY_MCO_IMAGE_DATA_TYPE) {
                    const legacyEnvelope = parseLegacyChannelBinaryEnvelope(envelope.payload);
                    if (!legacyEnvelope) {
                      continue;
                    }

                    const parsedMcoImage = await tryParseMcoImagePayload(legacyEnvelope.body);
                    if (parsedMcoImage) {
                      return {
                        decrypted: {
                          ...parsedMcoImage,
                          sender: parsedMcoImage.sender || legacyEnvelope.senderName,
                        },
                        error: null,
                      };
                    }

                    continue;
                  }

                  if (envelope.dataType === LEGACY_MCO_IMAGE_TEXT_DATA_TYPE) {
                    const legacyEnvelope = parseLegacyChannelBinaryEnvelope(envelope.payload);
                    const legacyTextPayload = legacyEnvelope?.body ?? envelope.payload;
                    const parsedMcoText = await tryParseMcoImageTextPayload(legacyTextPayload);

                    if (parsedMcoText) {
                      return {
                        decrypted: buildSyntheticTextMessage(parsedMcoText, legacyEnvelope?.senderName ?? ''),
                        error: null,
                      };
                    }

                    continue;
                  }

                  if (envelope.dataType !== MCO_ADVANCED_APP_DATA_TYPE) {
                    continue;
                  }

                  const parsedMcoImage = await tryParseMcoImagePayload(envelope.payload);
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

              continue;
            }

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

          if (decryptedPayloadCandidates.length > 0) {
            const firstCandidateLength = decryptedPayloadCandidates[0].length;
            return {
              decrypted: null,
              error: structuredDataTypes.size > 0
                ? `Binary payload decrypted but did not decode as supported MCOimg channel data (${Array.from(structuredDataTypes).join(', ')}, ${decryptedPayloadCandidates.length} candidate decryptions, first candidate ${firstCandidateLength} bytes).`
                : sawStructuredEnvelope
                  ? `Binary payload decrypted but could not be parsed as MCOimg (${firstCandidateLength} bytes, ${decryptedPayloadCandidates.length} candidate decryptions).`
                  : `Binary payload decrypted but did not match the MeshCore channel-data envelope ([data_type u16][length u8][payload]) or a known MCOimg payload (${firstCandidateLength} bytes, ${decryptedPayloadCandidates.length} candidate decryptions).`
                ,
            };
          }

          return {
            decrypted: null,
            error: await diagnoseMeshcoreGroupDecryptFailure({
              encrypted_message,
              mac,
              channel_hash,
              knownKeys,
            }),
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
