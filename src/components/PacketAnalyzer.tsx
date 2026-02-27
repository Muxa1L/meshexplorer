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
  0x0A: { name: "MULTIPART",  color: "bg-indigo-500" },
  0x0B: { name: "CONTROL",    color: "bg-pink-500" },
  0x0F: { name: "RAW_CUSTOM", color: "bg-gray-600" },
};

const ROUTE_TYPES: Record<number, string> = {
  0: "Flood",
  1: "Direct",
  2: "Managed",
  3: "Relay",
};

function getPayloadType(pt: number) {
  return PAYLOAD_TYPES[pt] ?? { name: `Type ${pt}`, color: "bg-gray-500" };
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function PacketRow({
  packet,
  isSelected,
  onClick,
}: {
  packet: MeshPacket;
  isSelected: boolean;
  onClick: () => void;
}) {
  const ptInfo = getPayloadType(packet.payload_type);
  const senderDisplay =
    packet.origin ||
    (packet.origin_pubkey
      ? `<${packet.origin_pubkey.slice(0, 8)}…>`
      : "—");

  let preview = "";
  if (packet.payload_type === 5 && packet.payload.length >= 6) {
    const channelHash = packet.payload.slice(0, 2).toUpperCase();
    preview = `ch:${channelHash} [encrypted]`;
  } else if (packet.path_len > 0 && packet.path) {
    const hops = packet.path.match(/.{1,2}/g) ?? [];
    preview = hops.join("→").slice(0, 32);
  } else if (packet.payload) {
    const raw = packet.payload.slice(0, 24);
    preview = raw + (packet.payload.length > 24 ? "…" : "");
  }

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
      <span
        className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium text-white ${ptInfo.color} w-20 justify-center`}
      >
        {ptInfo.name}
      </span>
      <span className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate w-28 flex-shrink-0">
        {senderDisplay}
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
      {copied ? (
        <span className="text-xs text-green-500 font-medium">Copied!</span>
      ) : (
        <ClipboardDocumentIcon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function PathChain({ path }: { path: string }) {
  if (!path) {
    return <span className="text-gray-400 dark:text-gray-500 italic text-xs">No path</span>;
  }
  const hops = path.match(/.{1,2}/g) ?? [];
  return (
    <div className="flex flex-wrap gap-1.5 items-center mt-2">
      {hops.map((hop, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 flex items-center justify-center font-mono text-xs text-purple-600 dark:text-purple-300">
            {hop}
          </span>
          {i < hops.length - 1 && (
            <ArrowRightIcon className="w-3 h-3 text-gray-400 dark:text-gray-500" />
          )}
        </span>
      ))}
    </div>
  );
}

function PacketDetail({
  packet,
  onClose,
}: {
  packet: MeshPacket;
  onClose: () => void;
}) {
  const ptInfo = getPayloadType(packet.payload_type);
  const isChannelMsg = packet.payload_type === 5;
  const channelHash = isChannelMsg ? packet.payload.slice(0, 2).toUpperCase() : null;
  const mac = isChannelMsg ? packet.payload.slice(2, 6).toUpperCase() : null;
  const encryptedPayload = isChannelMsg ? packet.payload.slice(6) : null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900 border-l border-gray-200 dark:border-neutral-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-neutral-700 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white ${ptInfo.color}`}
          >
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
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Timing
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ingest Time</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">
                {new Date(packet.ingest_timestamp).toLocaleString()}
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Mesh Time</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">
                {packet.mesh_timestamp
                  ? new Date(packet.mesh_timestamp).toLocaleString()
                  : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* Origin */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Origin
          </h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-2">
            {packet.origin && (
              <div className="flex gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-16 flex-shrink-0">Name</span>
                <span className="font-mono text-sm text-blue-600 dark:text-blue-400 break-all">
                  {packet.origin}
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-16 flex-shrink-0">Pubkey</span>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                {packet.origin_pubkey || "—"}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-16 flex-shrink-0">Source</span>
              <span className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                {packet.broker} / {packet.topic}
              </span>
            </div>
          </div>
        </section>

        {/* Packet header fields */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Packet Info
          </h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-1.5">
            <div className="flex gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">Payload Type</span>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {ptInfo.name} ({packet.payload_type})
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">Route Type</span>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {ROUTE_TYPES[packet.route_type] ?? packet.route_type}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">Version</span>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                {packet.payload_version}
              </span>
            </div>
            {packet.header && (
              <div className="flex gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">Header</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                  {packet.header}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Channel message fields */}
        {isChannelMsg && (
          <section>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Channel Message
            </h4>
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-2">
              <div className="flex gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-24 flex-shrink-0">Channel Hash</span>
                <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {channelHash}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-24 flex-shrink-0">MAC</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{mac}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 w-24 flex-shrink-0">Message Hash</span>
                <span className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                  {packet.message_hash || "—"}
                </span>
              </div>
              {encryptedPayload && (
                <div className="mt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400 dark:text-gray-500">Encrypted Data</span>
                    <CopyButton text={encryptedPayload} title="Copy encrypted data" />
                  </div>
                  <div className="bg-gray-100 dark:bg-neutral-950 rounded p-2 font-mono text-xs text-gray-500 dark:text-gray-500 break-all">
                    {encryptedPayload}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Routing */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Routing
          </h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>
                Type: {ROUTE_TYPES[packet.route_type] ?? `${packet.route_type}`}
              </span>
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
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Payload
            </h4>
            <CopyButton text={packet.payload} title="Copy payload hex" />
          </div>
          <div className="bg-gray-100 dark:bg-neutral-950 rounded-lg p-3 border border-gray-200 dark:border-neutral-800 font-mono text-xs text-gray-600 dark:text-gray-400 break-all leading-relaxed">
            {packet.payload || "(empty)"}
          </div>
        </section>

        {/* Raw packet hex */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Raw Packet
            </h4>
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

export default function PacketAnalyzer() {
  const [selectedPacket, setSelectedPacket] = useState<MeshPacket | null>(null);
  const [filterType, setFilterType] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [limit] = useState(1000);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["packets", filterType, limit],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
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
    for (const p of packets) {
      counts[p.payload_type] = (counts[p.payload_type] || 0) + 1;
    }
    return counts;
  }, [packets]);

  const filteredPackets = useMemo(
    () =>
      filterType === null ? packets : packets.filter((p) => p.payload_type === filterType),
    [packets, filterType]
  );

  const typeButtons = useMemo(
    () => Array.from(new Set(packets.map((p) => p.payload_type))).sort((a, b) => a - b),
    [packets]
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0 mr-1">
          Packet Analyzer
        </h2>
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
          {typeButtons.map((pt) => {
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
            onClick={() => setAutoRefresh((r) => !r)}
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
        <div
          className={`flex flex-col min-h-0 border-r border-gray-200 dark:border-neutral-700 ${
            selectedPacket ? "w-[55%]" : "w-full"
          }`}
        >
          {/* Column headers */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
            <span className="w-20 flex-shrink-0">Time</span>
            <span className="w-20 flex-shrink-0">Type</span>
            <span className="w-28 flex-shrink-0">Sender</span>
            <span className="w-14 flex-shrink-0 text-center">Hops</span>
            <span className="flex-1">Preview</span>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-neutral-800">
            {isLoading ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">
                Loading packets…
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-24 text-sm text-red-500 dark:text-red-400">
                Failed to load packets
              </div>
            ) : filteredPackets.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">
                No packets found
              </div>
            ) : (
              filteredPackets.map((p, idx) => (
                <PacketRow
                  key={`${p.ingest_timestamp}-${p.message_hash || idx}`}
                  packet={p}
                  isSelected={selectedPacket === p}
                  onClick={() => setSelectedPacket((prev) => (prev === p ? null : p))}
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
