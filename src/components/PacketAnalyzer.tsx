"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildApiUrl } from "@/lib/api";
import {
  XMarkIcon,
  ClipboardDocumentIcon,
  ArrowRightIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  decodePacket,
  payloadPreview,
  type DecodedPayload,
} from "@/lib/packet-decode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeshPacket {
  ingest_timestamp: string;
  mesh_timestamp: string;
  broker: string;
  topic: string;
  packet: string;
  payload: string;
  path_len: number;
  path: string;
  route_type: number;
  payload_type: number;
  payload_version: number;
  header: string;
  origin_pubkey: string;
  message_hash: string;
  origin: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAYLOAD_TYPES: Record<number, { name: string; color: string }> = {
  0x00: { name: "REQ",        color: "bg-orange-500" },
  0x01: { name: "RESPONSE",   color: "bg-yellow-500" },
  0x02: { name: "TXT_MSG",    color: "bg-teal-500" },
  0x03: { name: "ACK",        color: "bg-gray-400" },
  0x04: { name: "ADVERT",     color: "bg-blue-500" },
  0x05: { name: "GRP_TXT",    color: "bg-emerald-500" },
  0x06: { name: "GRP_DATA",   color: "bg-green-600" },
  0x07: { name: "ANON_REQ",   color: "bg-orange-400" },
  0x08: { name: "PATH",       color: "bg-purple-500" },
  0x09: { name: "TRACE",      color: "bg-red-500" },
  0x0a: { name: "MULTIPART",  color: "bg-indigo-500" },
  0x0b: { name: "CONTROL",    color: "bg-pink-500" },
  0x0f: { name: "RAW_CUSTOM", color: "bg-gray-600" },
};

const ROUTE_TYPES: Record<number, string> = {
  0: "TRANSPORT_FLOOD",
  1: "FLOOD",
  2: "DIRECT",
  3: "TRANSPORT_DIRECT",
};

function getPayloadType(pt: number) {
  return PAYLOAD_TYPES[pt] ?? { name: `0x${pt.toString(16).toUpperCase()}`, color: "bg-gray-500" };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

function Field({ label, value, mono = true, wide = false }: {
  label: string; value: React.ReactNode; mono?: boolean; wide?: boolean;
}) {
  return (
    <div className={`flex gap-2 ${wide ? "flex-col" : ""}`}>
      <span className={`text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ${wide ? "" : "w-24"}`}>
        {label}
      </span>
      <span className={`${mono ? "font-mono text-xs" : "text-sm"} text-gray-800 dark:text-gray-200 break-all`}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecodedSection — structured decoded fields per payload type
// ---------------------------------------------------------------------------

function DecodedSection({ decoded }: { decoded: DecodedPayload }) {
  switch (decoded.type) {
    case "REQ":
      return (
        <div className="space-y-1.5">
          <Field label="Dest hash" value={decoded.dest_hash} />
          <Field label="Src hash"  value={decoded.src_hash} />
          {decoded.encrypted && <Field label="Encrypted" value={decoded.encrypted} wide />}
        </div>
      );

    case "RESPONSE":
      return (
        <div className="space-y-1.5">
          <Field label="Dest hash" value={decoded.dest_hash} />
          <Field label="Src hash"  value={decoded.src_hash} />
          {decoded.encrypted && <Field label="Encrypted" value={decoded.encrypted} wide />}
        </div>
      );

    case "TXT_MSG":
      return (
        <div className="space-y-1.5">
          <Field label="Dest hash" value={decoded.dest_hash} />
          <Field label="Src hash"  value={decoded.src_hash} />
          {decoded.encrypted && <Field label="Encrypted" value={decoded.encrypted} wide />}
        </div>
      );

    case "ACK":
      return (
        <div className="space-y-1.5">
          <Field label="CRC-32" value={decoded.checksum} />
        </div>
      );

    case "ADVERT": {
      const ts = decoded.timestamp ? new Date(decoded.timestamp * 1000).toLocaleString() : "—";
      return (
        <div className="space-y-1.5">
          <Field label="Role"      value={decoded.role} />
          {decoded.name && <Field label="Name"  value={decoded.name} mono={false} />}
          <Field label="Pub key"   value={decoded.pub_key} wide />
          <Field label="Timestamp" value={ts} mono={false} />
          <Field label="Flags"     value={`0x${decoded.flags.toString(16).toUpperCase().padStart(2, "0")}`} />
          {decoded.has_location && decoded.lat !== undefined && (
            <>
              <Field label="Latitude"  value={decoded.lat.toFixed(6)} />
              <Field label="Longitude" value={decoded.lon!.toFixed(6)} />
            </>
          )}
        </div>
      );
    }

    case "GRP_TXT":
      return (
        <div className="space-y-1.5">
          <Field label="Channel hash" value={decoded.channel_hash} />
          <Field label="MAC"          value={decoded.mac} />
          <Field label="Ciphertext"   value={decoded.ciphertext} wide />
        </div>
      );

    case "GRP_DATA":
      return (
        <div className="space-y-1.5">
          <Field label="Channel hash" value={decoded.channel_hash} />
          <Field label="MAC"          value={decoded.mac} />
          <Field label="Data"         value={decoded.data} wide />
        </div>
      );

    case "ANON_REQ":
      return (
        <div className="space-y-1.5">
          <Field label="Dest hash"  value={decoded.dest_hash} />
          <Field label="Src pubkey" value={decoded.src_pubkey} wide />
          {decoded.encrypted && <Field label="Encrypted" value={decoded.encrypted} wide />}
        </div>
      );

    case "PATH":
      return (
        <div className="space-y-1.5">
          <Field label="Dest hash" value={decoded.dest_hash} />
          <Field label="Src hash"  value={decoded.src_hash} />
          {decoded.encrypted && <Field label="Encrypted" value={decoded.encrypted} wide />}
        </div>
      );

    case "TRACE":
      return (
        <div className="space-y-1.5">
          <Field label="Tag"       value={`0x${decoded.tag.toString(16).toUpperCase().padStart(8, "0")}`} />
          <Field label="Flags"     value={`0x${decoded.flags.toString(16).toUpperCase().padStart(2, "0")}`} />
          {decoded.auth_code !== 0 && <Field label="Auth code" value={decoded.auth_code.toString()} />}
          {decoded.path_hashes.length > 0 && (
            <div>
              <span className="text-xs text-gray-400 dark:text-gray-500">Path ({decoded.path_hashes.length} hop{decoded.path_hashes.length !== 1 ? "s" : ""})</span>
              <div className="flex flex-wrap gap-1.5 items-center mt-1">
                {decoded.path_hashes.map((h, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                      {h}
                    </span>
                    {i < decoded.path_hashes.length - 1 && (
                      <ArrowRightIcon className="w-3 h-3 text-gray-400" />
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {decoded.snrs.length > 0 && (
            <div>
              <span className="text-xs text-gray-400 dark:text-gray-500">SNR per hop</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {decoded.snrs.map((snr, i) => (
                  <span key={i} className="font-mono text-xs px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-gray-700 dark:text-gray-300">
                    {snr.toFixed(1)} dB
                  </span>
                ))}
              </div>
            </div>
          )}
          {decoded.snrs.length === 0 && decoded.path_hashes.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic">No SNR data yet (outbound)</span>
          )}
        </div>
      );

    default:
      return (
        <div className="font-mono text-xs text-gray-500 dark:text-gray-400 break-all">
          {decoded.data || "(no data)"}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// PacketRow
// ---------------------------------------------------------------------------

function PacketRow({ packet, isSelected, onClick }: {
  packet: MeshPacket; isSelected: boolean; onClick: () => void;
}) {
  const ptInfo = getPayloadType(packet.payload_type);
  const sender = packet.origin || (packet.origin_pubkey ? `<${packet.origin_pubkey.slice(0, 8)}…>` : "—");

  const preview = useMemo(() => {
    if (!packet.payload) return "";
    try { return payloadPreview(decodePacket(packet.packet)); }
    catch { return packet.packet.slice(0, 24); }
  }, [packet.payload, packet.payload_type]);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-l-2 transition-colors text-sm select-none ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500"
          : "border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800"
      }`}
    >
      <span className="font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap w-20 flex-shrink-0">
        {formatTimestamp(packet.ingest_timestamp)}
      </span>
      <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium text-white ${ptInfo.color} w-20 justify-center`}>
        {ptInfo.name}
      </span>
      <span className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate w-28 flex-shrink-0">
        {sender}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 w-14 text-center">
        {packet.path_len > 0 ? `${packet.path_len}h` : "direct"}
      </span>
      <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1 font-mono">
        {preview}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
      title={title}
    >
      {copied
        ? <span className="text-xs text-green-500 font-medium">Copied!</span>
        : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PathChain — routing path visualization
// ---------------------------------------------------------------------------

function PathChain({ path }: { path: string }) {
  if (!path) return <span className="text-gray-400 dark:text-gray-500 italic text-xs">No path</span>;
  const hops = path.match(/.{1,2}/g) ?? [];
  return (
    <div className="flex flex-wrap gap-1.5 items-center mt-2">
      {hops.map((hop, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 flex items-center justify-center font-mono text-xs text-purple-600 dark:text-purple-300">
            {hop}
          </span>
          {i < hops.length - 1 && <ArrowRightIcon className="w-3 h-3 text-gray-400 dark:text-gray-500" />}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PacketDetail panel
// ---------------------------------------------------------------------------

function PacketDetail({ packet, onClose }: { packet: MeshPacket; onClose: () => void }) {
  const ptInfo  = getPayloadType(packet.payload_type);
  const decoded = useMemo(
    () => decodePacket(packet.packet),
    [packet.packet],
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900 border-l border-gray-200 dark:border-neutral-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-neutral-700 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white ${ptInfo.color}`}>
            {ptInfo.name}
          </span>
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
            {packet.message_hash ? packet.message_hash.slice(0, 16) + "…" : "—"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-gray-400 transition-colors"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Timing */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Timing</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ingest Time</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">{new Date(packet.ingest_timestamp).toLocaleString()}</div>
            </div>
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Mesh Time</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">
                {packet.mesh_timestamp ? new Date(packet.mesh_timestamp).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* Origin */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Origin</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-2">
            {packet.origin && (
              <Field label="Name" value={<span className="text-blue-600 dark:text-blue-400">{packet.origin}</span>} mono={false} />
            )}
            <Field label="Pubkey" value={packet.origin_pubkey || "—"} />
            <Field label="Source" value={`${packet.broker} / ${packet.topic}`} />
          </div>
        </section>

        {/* Packet header */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Packet Info</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-1.5">
            <Field label="Payload Type" value={`${ptInfo.name} (0x${packet.payload_type.toString(16).toUpperCase()})`} />
            <Field label="Route Type"   value={ROUTE_TYPES[packet.route_type] ?? `0x${packet.route_type.toString(16)}`} />
            <Field label="Version"      value={String(packet.payload_version)} />
            {packet.header && <Field label="Header" value={packet.header} />}
          </div>
        </section>

        {/* Decoded payload */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Decoded</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
            <DecodedSection decoded={decoded} />
          </div>
        </section>

        {/* Routing */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Routing</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Type: {ROUTE_TYPES[packet.route_type] ?? `0x${packet.route_type.toString(16)}`}</span>
              <span>Hops: {packet.path_len}</span>
            </div>
            <PathChain path={packet.path} />
            {packet.path && (
              <div className="mt-3 font-mono text-xs text-gray-500 dark:text-gray-500 break-all bg-gray-100 dark:bg-black/20 p-2 rounded">
                {packet.path}
              </div>
            )}
          </div>
        </section>

        {/* Payload hex */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Payload (hex)</h4>
            <CopyButton text={packet.payload} title="Copy payload hex" />
          </div>
          <div className="bg-gray-100 dark:bg-neutral-950 rounded-lg p-3 border border-gray-200 dark:border-neutral-800 font-mono text-xs text-gray-600 dark:text-gray-400 break-all leading-relaxed">
            {packet.payload || "(empty)"}
          </div>
        </section>

        {/* Raw packet hex */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Raw Packet (hex)</h4>
            <CopyButton text={packet.packet} title="Copy raw packet hex" />
          </div>
          <div className="bg-gray-100 dark:bg-neutral-950 rounded-lg p-3 border border-gray-200 dark:border-neutral-800 font-mono text-xs text-gray-600 dark:text-gray-400 break-all leading-relaxed">
            {packet.packet || "(empty)"}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PacketAnalyzer — main component
// ---------------------------------------------------------------------------

export default function PacketAnalyzer() {
  const [selectedPacket, setSelectedPacket] = useState<MeshPacket | null>(null);
  const [filterType, setFilterType]         = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh]       = useState(true);
  const [limit]                             = useState(1000);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["packets", limit],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      const res = await fetch(buildApiUrl(`/api/packets?${params}`), { signal });
      if (!res.ok) throw new Error("Failed to fetch packets");
      return res.json() as Promise<{ packets: MeshPacket[] }>;
    },
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 2000,
  });

  const packets = data?.packets ?? [];

  const stats = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const p of packets) counts[p.payload_type] = (counts[p.payload_type] || 0) + 1;
    return counts;
  }, [packets]);

  const filteredPackets = useMemo(
    () => filterType === null ? packets : packets.filter(p => p.payload_type === filterType),
    [packets, filterType],
  );

  const typeButtons = useMemo(
    () => Array.from(new Set(packets.map(p => p.payload_type))).sort((a, b) => a - b),
    [packets],
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0 mr-1">Packet Analyzer</h2>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          <button
            onClick={() => setFilterType(null)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filterType === null
                ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
            }`}
          >
            All ({packets.length})
          </button>
          {typeButtons.map(pt => {
            const info = getPayloadType(pt);
            return (
              <button
                key={pt}
                onClick={() => setFilterType(filterType === pt ? null : pt)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filterType === pt
                    ? `${info.color} text-white`
                    : "bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
                }`}
              >
                {info.name} ({stats[pt] || 0})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            onClick={() => setAutoRefresh(r => !r)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              autoRefresh
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-gray-400"
            }`}
          >
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-gray-400 disabled:opacity-50 transition-colors"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Packet list */}
        <div className={`flex flex-col min-h-0 border-r border-gray-200 dark:border-neutral-700 ${selectedPacket ? "w-[55%]" : "w-full"}`}>
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
            <span className="w-20 flex-shrink-0">Time</span>
            <span className="w-20 flex-shrink-0">Type</span>
            <span className="w-28 flex-shrink-0">Sender</span>
            <span className="w-14 flex-shrink-0 text-center">Hops</span>
            <span className="flex-1">Preview</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-neutral-800">
            {isLoading ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">Loading packets…</div>
            ) : error ? (
              <div className="flex items-center justify-center h-24 text-sm text-red-500 dark:text-red-400">Failed to load packets</div>
            ) : filteredPackets.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">No packets found</div>
            ) : (
              filteredPackets.map((p, idx) => (
                <PacketRow
                  key={`${p.ingest_timestamp}-${p.message_hash || idx}`}
                  packet={p}
                  isSelected={selectedPacket === p}
                  onClick={() => setSelectedPacket(prev => prev === p ? null : p)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedPacket && (
          <div className="w-[45%] min-h-0 overflow-hidden">
            <PacketDetail packet={selectedPacket} onClose={() => setSelectedPacket(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
