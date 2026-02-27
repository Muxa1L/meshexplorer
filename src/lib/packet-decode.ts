/**
 * MeshCore packet decoder using @liamcottle/meshcore.js.
 *
 * Takes the full raw packet hex (as returned by ClickHouse hex(packet)),
 * parses it with the library's Packet / Advert classes, and returns a
 * typed decoded structure per payload type.
 *
 * Note on encryption: REQ, RESPONSE, TXT_MSG, ANON_REQ, PATH payloads are
 * all encrypted. Only the unencrypted outer fields (dest/src hashes) are
 * visible without the private key. ADVERT, ACK, GRP_TXT, GRP_DATA and
 * CONTROL are either plaintext or use shared-key encryption.
 */

// @ts-expect-error — JS-only package, types declared in src/types/meshcore.d.ts
import { Packet, Advert } from "@liamcottle/meshcore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function byteToHex(b: number): string {
  return b.toString(16).padStart(2, "0").toUpperCase();
}

// ---------------------------------------------------------------------------
// Decoded payload union type
// ---------------------------------------------------------------------------

export interface DecodedREQ {
  type: "REQ";
  dest_hash: string;
  src_hash: string;
  encrypted: string; // hex
}

export interface DecodedRESPONSE {
  type: "RESPONSE";
  dest_hash: string;
  src_hash: string;
  encrypted: string;
}

export interface DecodedTXT_MSG {
  type: "TXT_MSG";
  dest_hash: string;
  src_hash: string;
  encrypted: string;
}

export interface DecodedACK {
  type: "ACK";
  checksum: string; // 4-byte CRC hex
}

export interface DecodedADVERT {
  type: "ADVERT";
  pub_key: string;   // 32-byte hex
  timestamp: number; // unix epoch (seconds)
  role: string;      // NONE / CHAT / REPEATER / ROOM
  has_location: boolean;
  lat?: number;      // decimal degrees
  lon?: number;
  has_name: boolean;
  name?: string;
  flags: number;
}

export interface DecodedGRP_TXT {
  type: "GRP_TXT";
  channel_hash: string; // 1-byte hex
  mac: string;          // 2-byte hex
  ciphertext: string;
}

export interface DecodedGRP_DATA {
  type: "GRP_DATA";
  channel_hash: string;
  mac: string;
  data: string;
}

export interface DecodedANON_REQ {
  type: "ANON_REQ";
  dest_hash: string;
  src_pubkey: string; // 32-byte hex ephemeral public key
  encrypted: string;
}

export interface DecodedPATH {
  type: "PATH";
  dest_hash: string;
  src_hash: string;
  encrypted: string;
}

export interface DecodedTRACE {
  type: "TRACE";
  tag: number;           // uint32 trace identifier
  auth_code: number;     // uint32, usually 0
  flags: number;         // uint8
  path_hashes: string[]; // 1-byte hex per hop — intended/accumulated path
  snrs: number[];        // dB per hop — from outer packet.path (int8 ÷ 4)
}

export interface DecodedRaw {
  type: "MULTIPART" | "CONTROL" | "RAW_CUSTOM" | "UNKNOWN";
  data: string;
}

export type DecodedPayload =
  | DecodedREQ
  | DecodedRESPONSE
  | DecodedTXT_MSG
  | DecodedACK
  | DecodedADVERT
  | DecodedGRP_TXT
  | DecodedGRP_DATA
  | DecodedANON_REQ
  | DecodedPATH
  | DecodedTRACE
  | DecodedRaw;

// ---------------------------------------------------------------------------
// Main decoder — takes the full raw packet hex (hex(packet) from DB)
// ---------------------------------------------------------------------------

export function decodePacket(rawPacketHex: string): DecodedPayload {
  if (!rawPacketHex) return { type: "UNKNOWN", data: "" };
  try {
    const bytes = hexToUint8Array(rawPacketHex);
    const packet = Packet.fromBytes(bytes);
    const p: Uint8Array = packet.payload;

    switch (packet.payload_type) {

      case Packet.PAYLOAD_TYPE_ADVERT: {
        const advert = Advert.fromBytes(p);
        const app = advert.parseAppData();
        const hasLoc = app.lat !== null && app.lat !== undefined;
        return {
          type: "ADVERT",
          pub_key: bytesToHex(advert.publicKey),
          timestamp: advert.timestamp,
          role: advert.getTypeString() ?? "NONE",
          has_location: hasLoc,
          lat: hasLoc ? (app.lat as number) / 1_000_000 : undefined,
          lon: hasLoc ? (app.lon as number) / 1_000_000 : undefined,
          has_name: app.name !== null && app.name !== undefined,
          name: app.name ?? undefined,
          flags: advert.getFlags(),
        };
      }

      case Packet.PAYLOAD_TYPE_ACK: {
        return {
          type: "ACK",
          checksum: p.length >= 4 ? bytesToHex(p.slice(0, 4)) : "??",
        };
      }

      case Packet.PAYLOAD_TYPE_REQ: {
        return {
          type: "REQ",
          dest_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          src_hash:  p.length >= 2 ? byteToHex(p[1]) : "??",
          encrypted: p.length > 2 ? bytesToHex(p.slice(2)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_RESPONSE: {
        return {
          type: "RESPONSE",
          dest_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          src_hash:  p.length >= 2 ? byteToHex(p[1]) : "??",
          encrypted: p.length > 2 ? bytesToHex(p.slice(2)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_TXT_MSG: {
        return {
          type: "TXT_MSG",
          dest_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          src_hash:  p.length >= 2 ? byteToHex(p[1]) : "??",
          encrypted: p.length > 2 ? bytesToHex(p.slice(2)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_GRP_TXT: {
        return {
          type: "GRP_TXT",
          channel_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          mac:          p.length >= 3 ? bytesToHex(p.slice(1, 3)) : "??",
          ciphertext:   p.length > 3  ? bytesToHex(p.slice(3)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_GRP_DATA: {
        return {
          type: "GRP_DATA",
          channel_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          mac:          p.length >= 3 ? bytesToHex(p.slice(1, 3)) : "??",
          data:         p.length > 3  ? bytesToHex(p.slice(3)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_ANON_REQ: {
        return {
          type: "ANON_REQ",
          dest_hash:  p.length >= 1  ? byteToHex(p[0]) : "??",
          src_pubkey: p.length >= 33 ? bytesToHex(p.slice(1, 33)) : "??",
          encrypted:  p.length > 33  ? bytesToHex(p.slice(33)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_PATH: {
        return {
          type: "PATH",
          dest_hash: p.length >= 1 ? byteToHex(p[0]) : "??",
          src_hash:  p.length >= 2 ? byteToHex(p[1]) : "??",
          encrypted: p.length > 2 ? bytesToHex(p.slice(2)) : "",
        };
      }

      case Packet.PAYLOAD_TYPE_TRACE: {
        // payload: [tag:4LE][auth_code:4LE][flags:1][path_hashes:variable]
        // packet.path: SNR bytes for each hop (int8 × 4 stored, ÷ 4 to get dB)
        const tag = p.length >= 4
          ? ((p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0)
          : 0;
        const auth_code = p.length >= 8
          ? ((p[4] | (p[5] << 8) | (p[6] << 16) | (p[7] << 24)) >>> 0)
          : 0;
        const flags = p.length >= 9 ? p[8] : 0;
        const path_hashes = p.length > 9
          ? Array.from(p.slice(9)).map(b => byteToHex(b))
          : [];
        const snrs: number[] = Array.from(packet.path as Uint8Array).map(
          b => (b > 127 ? b - 256 : b) / 4,
        );
        return { type: "TRACE", tag, auth_code, flags, path_hashes, snrs };
      }

      case Packet.PAYLOAD_TYPE_RAW_CUSTOM:
        return { type: "RAW_CUSTOM", data: bytesToHex(p) };

      // MULTIPART (0x0A) and CONTROL (0x0B) are not in the library constants
      default: {
        const t = packet.payload_type;
        if (t === 0x0a) return { type: "MULTIPART", data: bytesToHex(p) };
        if (t === 0x0b) return { type: "CONTROL",   data: bytesToHex(p) };
        return { type: "UNKNOWN", data: bytesToHex(p) };
      }
    }
  } catch {
    return { type: "UNKNOWN", data: "" };
  }
}

// ---------------------------------------------------------------------------
// Short preview string for the list row
// ---------------------------------------------------------------------------

export function payloadPreview(decoded: DecodedPayload): string {
  switch (decoded.type) {
    case "REQ":
      return `→ ${decoded.dest_hash} ← ${decoded.src_hash} [encrypted]`;
    case "RESPONSE":
      return `→ ${decoded.dest_hash} ← ${decoded.src_hash} [encrypted]`;
    case "TXT_MSG":
      return `→ ${decoded.dest_hash} ← ${decoded.src_hash} [encrypted]`;
    case "ACK":
      return `crc: ${decoded.checksum}`;
    case "ADVERT": {
      const id = decoded.name || decoded.pub_key.slice(0, 8) + "…";
      const loc =
        decoded.has_location && decoded.lat !== undefined
          ? ` @ ${decoded.lat.toFixed(4)}, ${decoded.lon!.toFixed(4)}`
          : "";
      return `${decoded.role}: ${id}${loc}`;
    }
    case "GRP_TXT":
      return `ch:${decoded.channel_hash} mac:${decoded.mac} [encrypted]`;
    case "GRP_DATA":
      return `ch:${decoded.channel_hash} [data]`;
    case "ANON_REQ":
      return `→ ${decoded.dest_hash} [anon encrypted]`;
    case "PATH":
      return `→ ${decoded.dest_hash} ← ${decoded.src_hash} [encrypted]`;
    case "TRACE": {
      const hops = decoded.path_hashes.length;
      const snrStr = decoded.snrs.length > 0
        ? decoded.snrs.map(s => `${s.toFixed(1)}dB`).join(" → ")
        : "no snr";
      return `tag:${decoded.tag.toString(16).toUpperCase()} ${hops}hop${hops !== 1 ? "s" : ""} [${snrStr}]`;
    }
    case "MULTIPART": return "multipart";
    case "CONTROL":   return decoded.data.slice(0, 24) || "control";
    case "RAW_CUSTOM":return decoded.data.slice(0, 24) || "raw";
    case "UNKNOWN":   return decoded.data.slice(0, 24) || "(empty)";
  }
}
