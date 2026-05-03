"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { buildApiUrl } from "@/lib/api";
import {
  XMarkIcon,
  ClipboardDocumentIcon,
  ArrowRightIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RectangleGroupIcon,
} from "@heroicons/react/24/outline";
import {
  decodePacket,
  packetGroupKey,
  payloadPreview,
  type DecodedPayload,
} from "@/lib/packet-decode";
import { splitPathHex } from "@/lib/pathUtils";
import { useLocale } from "./LocaleProvider";

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

interface PacketPage {
  packets: MeshPacket[];
  hasMore: boolean;
  oldestTimestamp?: string;
}

function getPacketCacheKey(packet: MeshPacket) {
  return [
    packet.ingest_timestamp,
    packet.message_hash || 'no-hash',
    packet.broker || 'no-broker',
    packet.topic || 'no-topic',
    packet.origin_pubkey || 'no-origin',
    packet.packet || 'no-packet',
  ].join('|');
}

function mergeIncomingPackets(existingPackets: MeshPacket[], incomingPackets: MeshPacket[], limit: number) {
  const packetMap = new Map<string, MeshPacket>();

  for (const packet of existingPackets) {
    packetMap.set(getPacketCacheKey(packet), packet);
  }

  for (const packet of incomingPackets) {
    packetMap.set(getPacketCacheKey(packet), packet);
  }

  return Array.from(packetMap.values())
    .sort((a, b) => new Date(b.ingest_timestamp).getTime() - new Date(a.ingest_timestamp).getTime())
    .slice(0, limit);
}

function rebuildPacketPages(packets: MeshPacket[], pageSize: number, lastPageHasMore: boolean) {
  const pages: PacketPage[] = [];

  for (let index = 0; index < packets.length; index += pageSize) {
    const pagePackets = packets.slice(index, index + pageSize);
    pages.push({
      packets: pagePackets,
      hasMore: false,
      oldestTimestamp: pagePackets[pagePackets.length - 1]?.ingest_timestamp,
    });
  }

  if (pages.length > 0) {
    pages[pages.length - 1] = {
      ...pages[pages.length - 1],
      hasMore: lastPageHasMore,
    };
  }

  return pages;
}

function mergeIncomingPacketPages(oldData: any, incomingPackets: MeshPacket[], pageSize: number) {
  if (!oldData?.pages?.length || incomingPackets.length === 0) {
    return oldData;
  }

  const allExistingPackets = oldData.pages.flatMap((page: PacketPage) => page.packets);
  const mergedPackets = mergeIncomingPackets(allExistingPackets, incomingPackets, Number.MAX_SAFE_INTEGER);
  const lastPageHasMore = oldData.pages[oldData.pages.length - 1]?.hasMore ?? false;

  return {
    ...oldData,
    pages: rebuildPacketPages(mergedPackets, pageSize, lastPageHasMore),
  };
}

interface PacketGroup {
  key: string;
  label: string;
  packets: MeshPacket[];
  ptInfo: { name: string; color: string };
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

const PACKET_PAGE_SIZE = 100;
const PACKET_LOAD_MORE_THRESHOLD_PX = 640;

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
  const { t } = useLocale();

  switch (decoded.type) {
    case "REQ":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.destHash")} value={decoded.dest_hash} />
          <Field label={t("packetAnalyzer.srcHash")}  value={decoded.src_hash} />
          {decoded.encrypted && <Field label={t("packetAnalyzer.encrypted")} value={decoded.encrypted} wide />}
        </div>
      );

    case "RESPONSE":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.destHash")} value={decoded.dest_hash} />
          <Field label={t("packetAnalyzer.srcHash")}  value={decoded.src_hash} />
          {decoded.encrypted && <Field label={t("packetAnalyzer.encrypted")} value={decoded.encrypted} wide />}
        </div>
      );

    case "TXT_MSG":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.destHash")} value={decoded.dest_hash} />
          <Field label={t("packetAnalyzer.srcHash")}  value={decoded.src_hash} />
          {decoded.encrypted && <Field label={t("packetAnalyzer.encrypted")} value={decoded.encrypted} wide />}
        </div>
      );

    case "ACK":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.crc32")} value={decoded.checksum} />
        </div>
      );

    case "ADVERT": {
      const ts = decoded.timestamp ? new Date(decoded.timestamp * 1000).toLocaleString() : "—";
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.role")} value={decoded.role} />
          {decoded.name && <Field label={t("packetAnalyzer.name")} value={decoded.name} mono={false} />}
          <Field label={t("packetAnalyzer.pubKey")} value={decoded.pub_key} wide />
          <Field label={t("packetAnalyzer.timestamp")} value={ts} mono={false} />
          <Field label={t("packetAnalyzer.flags")} value={`0x${decoded.flags.toString(16).toUpperCase().padStart(2, "0")}`} />
          {decoded.has_location && decoded.lat !== undefined && (
            <>
              <Field label={t("packetAnalyzer.latitude")} value={decoded.lat.toFixed(6)} />
              <Field label={t("packetAnalyzer.longitude")} value={decoded.lon!.toFixed(6)} />
            </>
          )}
        </div>
      );
    }

    case "GRP_TXT":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.channelHash")} value={decoded.channel_hash} />
          <Field label={t("packetAnalyzer.mac")} value={decoded.mac} />
          <Field label={t("packetAnalyzer.ciphertext")} value={decoded.ciphertext} wide />
        </div>
      );

    case "GRP_DATA":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.channelHash")} value={decoded.channel_hash} />
          <Field label={t("packetAnalyzer.mac")} value={decoded.mac} />
          <Field label={t("packetAnalyzer.data")} value={decoded.data} wide />
        </div>
      );

    case "ANON_REQ":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.destHash")} value={decoded.dest_hash} />
          <Field label={t("packetAnalyzer.srcPubkey")} value={decoded.src_pubkey} wide />
          {decoded.encrypted && <Field label={t("packetAnalyzer.encrypted")} value={decoded.encrypted} wide />}
        </div>
      );

    case "PATH":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.destHash")} value={decoded.dest_hash} />
          <Field label={t("packetAnalyzer.srcHash")} value={decoded.src_hash} />
          {decoded.encrypted && <Field label={t("packetAnalyzer.encrypted")} value={decoded.encrypted} wide />}
        </div>
      );

    case "TRACE":
      return (
        <div className="space-y-1.5">
          <Field label={t("packetAnalyzer.tag")} value={`0x${decoded.tag.toString(16).toUpperCase().padStart(8, "0")}`} />
          <Field label={t("packetAnalyzer.flags")} value={`0x${decoded.flags.toString(16).toUpperCase().padStart(2, "0")}`} />
          {decoded.auth_code !== 0 && <Field label={t("packetAnalyzer.authCode")} value={decoded.auth_code.toString()} />}
          {decoded.path_hashes.length > 0 && (
            <div>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t("packetAnalyzer.path")} ({decoded.path_hashes.length} {t("packetAnalyzer.hop")}{decoded.path_hashes.length !== 1 ? "s" : ""})</span>
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
              <span className="text-xs text-gray-400 dark:text-gray-500">{t("packetAnalyzer.snrPerHop")}</span>
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
            <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t("packetAnalyzer.noSnrData")}</span>
          )}
        </div>
      );

    default:
      return (
        <div className="font-mono text-xs text-gray-500 dark:text-gray-400 break-all">
          {decoded.data || t("common.noDataAvailable")}
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
  const { t } = useLocale();
  const ptInfo = getPayloadType(packet.payload_type);
  const sender = packet.origin || (packet.origin_pubkey ? `<${packet.origin_pubkey.slice(0, 8)}…>` : "—");

  const preview = useMemo(() => {
    if (!packet.payload) return "";
    try { return payloadPreview(decodePacket(packet.packet)); }
    catch { return packet.packet.slice(0, 24); }
  }, [packet.packet, packet.payload]);

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
        {packet.path_len > 0 ? `${packet.path_len}h` : t("packetAnalyzer.direct")}
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
  const { t } = useLocale();
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
        ? <span className="text-xs text-green-500 font-medium">{t("packetAnalyzer.copied")}</span>
        : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PathChain — routing path visualization
// ---------------------------------------------------------------------------

function PathChain({ path, pathLen }: { path: string; pathLen: number }) {
  const { t } = useLocale();
  if (!path) return <span className="text-gray-400 dark:text-gray-500 italic text-xs">{t("packetAnalyzer.noPath")}</span>;
  const hops = splitPathHex(path, pathLen);
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
// GroupHeader — collapsible section header for grouped mode
// ---------------------------------------------------------------------------

function GroupHeader({ group, collapsed, onToggle }: {
  group: PacketGroup; collapsed: boolean; onToggle: () => void;
}) {
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <div
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 hover:bg-gray-100 dark:hover:bg-neutral-750 select-none sticky top-0 z-10"
    >
      <Chevron className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium text-white ${group.ptInfo.color}`}>
        {group.ptInfo.name}
      </span>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 font-mono truncate flex-1">
        {group.label}
      </span>
      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
        {group.packets.length}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PacketDetail panel
// ---------------------------------------------------------------------------

function PacketDetail({ packet, onClose }: { packet: MeshPacket; onClose: () => void }) {
  const { t } = useLocale();
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
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("packetAnalyzer.timing")}</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("packetAnalyzer.ingestTime")}</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">{new Date(packet.ingest_timestamp).toLocaleString()}</div>
            </div>
            <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("packetAnalyzer.meshTime")}</div>
              <div className="font-mono text-xs text-gray-900 dark:text-gray-100">
                {packet.mesh_timestamp ? new Date(packet.mesh_timestamp).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* Origin */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("packetAnalyzer.origin")}</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-2">
            {packet.origin && (
              <Field label={t("packetAnalyzer.name")} value={<span className="text-blue-600 dark:text-blue-400">{packet.origin}</span>} mono={false} />
            )}
            <Field label={t("packetAnalyzer.pubkey")} value={packet.origin_pubkey || "—"} />
            <Field label={t("packetAnalyzer.source")} value={`${packet.broker} / ${packet.topic}`} />
          </div>
        </section>

        {/* Packet header */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("packetAnalyzer.packetInfo")}</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700 space-y-1.5">
            <Field label={t("packetAnalyzer.payloadType")} value={`${ptInfo.name} (0x${packet.payload_type.toString(16).toUpperCase()})`} />
            <Field label={t("packetAnalyzer.routeType")} value={ROUTE_TYPES[packet.route_type] ?? `0x${packet.route_type.toString(16)}`} />
            <Field label={t("packetAnalyzer.version")} value={String(packet.payload_version)} />
            {packet.header && <Field label={t("packetAnalyzer.header")} value={packet.header} />}
          </div>
        </section>

        {/* Decoded payload */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("packetAnalyzer.decoded")}</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
            <DecodedSection decoded={decoded} />
          </div>
        </section>

        {/* Routing */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t("packetAnalyzer.routing")}</h4>
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 border border-gray-200 dark:border-neutral-700">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{t("packetAnalyzer.routingType")}: {ROUTE_TYPES[packet.route_type] ?? `0x${packet.route_type.toString(16)}`}</span>
              <span>{t("packetAnalyzer.hopsLabel")}: {packet.path_len}</span>
            </div>
            <PathChain path={packet.path} pathLen={packet.path_len} />
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
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("packetAnalyzer.payloadHex")}</h4>
            <CopyButton text={packet.payload} title={t("packetAnalyzer.copyPayloadHex")} />
          </div>
          <div className="bg-gray-100 dark:bg-neutral-950 rounded-lg p-3 border border-gray-200 dark:border-neutral-800 font-mono text-xs text-gray-600 dark:text-gray-400 break-all leading-relaxed">
            {packet.payload || t("packetAnalyzer.empty")}
          </div>
        </section>

        {/* Raw packet hex */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("packetAnalyzer.rawPacketHex")}</h4>
            <CopyButton text={packet.packet} title={t("packetAnalyzer.copyRawPacketHex")} />
          </div>
          <div className="bg-gray-100 dark:bg-neutral-950 rounded-lg p-3 border border-gray-200 dark:border-neutral-800 font-mono text-xs text-gray-600 dark:text-gray-400 break-all leading-relaxed">
            {packet.packet || t("packetAnalyzer.empty")}
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
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const packetListRef = useRef<HTMLDivElement>(null);
  const [selectedPacket, setSelectedPacket]   = useState<MeshPacket | null>(null);
  const [filterType, setFilterType]           = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh]         = useState(true);
  const [groupMode, setGroupMode]             = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const packetsQueryKey = useMemo(
    () => ["packets", filterType] as const,
    [filterType],
  );

  const { data, isLoading, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: packetsQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PACKET_PAGE_SIZE) });
      if (filterType !== null) {
        params.set('payloadType', String(filterType));
      }
      if (pageParam) {
        params.set('before', pageParam);
      }
      const res = await fetch(buildApiUrl(`/api/packets?${params}`), { signal });
      if (!res.ok) throw new Error(t("packetAnalyzer.failedToLoadPackets"));
      const response = await res.json() as { packets: MeshPacket[] };
      const packets = Array.isArray(response.packets) ? response.packets : [];

      return {
        packets,
        hasMore: packets.length === PACKET_PAGE_SIZE,
        oldestTimestamp: packets[packets.length - 1]?.ingest_timestamp,
      } satisfies PacketPage;
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.oldestTimestamp : undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 2000,
  });

  const handleListScroll = useCallback(() => {
    const container = packetListRef.current;
    if (!container || !hasNextPage || isFetchingNextPage || isLoading) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= PACKET_LOAD_MORE_THRESHOLD_PX) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isLoading]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const params = new URLSearchParams({
      pollInterval: '1000',
      maxRows: String(PACKET_PAGE_SIZE),
      skipInitialMessages: 'true',
    });
    if (filterType !== null) {
      params.set('payloadType', String(filterType));
    }
    const eventSource = new EventSource(buildApiUrl(`/api/meshcore/stream/packets?${params.toString()}`));

    eventSource.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data) as MeshPacket & { type?: string };
        if (packet.type === 'error') {
          return;
        }

        queryClient.setQueryData(packetsQueryKey, (oldData: any) => mergeIncomingPacketPages(oldData, [packet], PACKET_PAGE_SIZE));
      } catch (error) {
        console.error('Failed to process streaming packet:', error);
      }
    };

    eventSource.onerror = () => {
      // Allow EventSource to reconnect automatically.
    };

    return () => {
      eventSource.close();
    };
  }, [autoRefresh, filterType, packetsQueryKey, queryClient]);

  const packets = useMemo(() => data?.pages.flatMap((page) => page.packets) ?? [], [data?.pages]);

  useEffect(() => {
    if (!selectedPacket) {
      return;
    }

    const updatedSelection = packets.find((packet) => getPacketCacheKey(packet) === getPacketCacheKey(selectedPacket));
    if (!updatedSelection) {
      setSelectedPacket(null);
      return;
    }

    if (updatedSelection !== selectedPacket) {
      setSelectedPacket(updatedSelection);
    }
  }, [packets, selectedPacket]);

  const stats = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const p of packets) counts[p.payload_type] = (counts[p.payload_type] || 0) + 1;
    return counts;
  }, [packets]);

  const typeButtons = useMemo(
    () => Object.keys(PAYLOAD_TYPES).map(Number).sort((a, b) => a - b),
    [],
  );

  const groups = useMemo<PacketGroup[]>(() => {
    const groupMap = new Map<string, PacketGroup>();
    const order: string[] = [];
    for (const packet of packets) {
      let decoded: DecodedPayload;
      try { decoded = decodePacket(packet.packet); } catch { decoded = { type: "UNKNOWN", data: "" }; }
      const { key, label } = packetGroupKey(decoded);
      if (!groupMap.has(key)) {
        groupMap.set(key, { key, label, packets: [], ptInfo: getPayloadType(packet.payload_type) });
        order.push(key);
      }
      groupMap.get(key)!.packets.push(packet);
    }
    return order.map(k => groupMap.get(k)!);
  }, [packets]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0 mr-1">{t("packetAnalyzer.title")}</h2>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          <button
            onClick={() => setFilterType(null)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filterType === null
                ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700"
            }`}
          >
            {t("packetAnalyzer.all")}
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
                {info.name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            onClick={() => { setGroupMode(m => !m); setCollapsedGroups(new Set()); }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              groupMode
                ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
            }`}
            title={t("packetAnalyzer.toggleGrouping")}
          >
            <RectangleGroupIcon className="w-3.5 h-3.5" />
            {groupMode ? t("packetAnalyzer.groups", { count: groups.length }) : t("packetAnalyzer.group")}
          </button>
          <button
            onClick={() => setAutoRefresh(r => !r)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              autoRefresh
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-gray-400"
            }`}
          >
            {autoRefresh ? t("packetAnalyzer.live") : t("packetAnalyzer.paused")}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-gray-400 disabled:opacity-50 transition-colors"
            title={t("packetAnalyzer.refresh")}
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
            <span className="w-20 flex-shrink-0">{t("packetAnalyzer.time")}</span>
            <span className="w-20 flex-shrink-0">{t("packetAnalyzer.type")}</span>
            <span className="w-28 flex-shrink-0">{t("packetAnalyzer.sender")}</span>
            <span className="w-14 flex-shrink-0 text-center">{t("packetAnalyzer.hops")}</span>
            <span className="flex-1">{t("packetAnalyzer.preview")}</span>
          </div>
          <div ref={packetListRef} onScroll={handleListScroll} className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-neutral-800">
            {isLoading ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">{t("packetAnalyzer.loadingPackets")}</div>
            ) : error ? (
              <div className="flex items-center justify-center h-24 text-sm text-red-500 dark:text-red-400">{t("packetAnalyzer.failedToLoadPackets")}</div>
            ) : packets.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-gray-500 dark:text-gray-400">{t("packetAnalyzer.noPacketsFound")}</div>
            ) : groupMode ? (
              <>
                {groups.map(group => (
                <div key={group.key}>
                  <GroupHeader
                    group={group}
                    collapsed={collapsedGroups.has(group.key)}
                    onToggle={() => toggleGroup(group.key)}
                  />
                  {!collapsedGroups.has(group.key) && group.packets.map((p, idx) => (
                    <PacketRow
                      key={getPacketCacheKey(p)}
                      packet={p}
                      isSelected={selectedPacket === p}
                      onClick={() => setSelectedPacket(prev => prev === p ? null : p)}
                    />
                  ))}
                </div>
                ))}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center h-16 text-sm text-gray-500 dark:text-gray-400">{t("packetAnalyzer.loadingPackets")}</div>
                )}
              </>
            ) : (
              <>
                {packets.map((p) => (
                <PacketRow
                  key={getPacketCacheKey(p)}
                  packet={p}
                  isSelected={selectedPacket === p}
                  onClick={() => setSelectedPacket(prev => prev === p ? null : p)}
                />
                ))}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center h-16 text-sm text-gray-500 dark:text-gray-400">{t("packetAnalyzer.loadingPackets")}</div>
                )}
              </>
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
