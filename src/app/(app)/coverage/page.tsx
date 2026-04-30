"use client";
import AppPageShell from "@/components/AppPageShell";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { geohashDecodeBbox } from "@/lib/wardrive/geohash";

// ─── Types ───────────────────────────────────────────────────────────────────
interface CoverageTile {
  hash: string;
  received: number;
  lost: number;
  samples: number;
  repeaters: Record<string, { name: string; rssi: number | null; snr: number | null; lastSeen: string }>;
  lastUpdate: string;
}

interface Repeater {
  id: string;
  legacyId: string;
  publicKey: string;
  prefixes: string[];
  name: string;
  lat: number;
  lon: number;
  last_seen: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseDate(str: string): Date {
  // ClickHouse returns DateTime as "YYYY-MM-DD HH:MM:SS"; make it ISO-parseable
  return new Date(String(str).replace(" ", "T"));
}

function tileColor(received: number, lost: number): string {
  const total = received + lost;
  if (total === 0) return "#94a3b8";
  const ratio = received / total;
  if (ratio >= 0.8) return "#4ade80";
  if (ratio >= 0.5) return "#facc15";
  if (ratio >= 0.2) return "#fb923c";
  return "#f87171";
}

function repeaterColor(lastSeenStr: string): string {
  const days = (Date.now() - parseDate(lastSeenStr).getTime()) / 86_400_000;
  if (days < 1) return "#3b82f6";
  if (days < 5) return "#94a3b8";
  return "#4b5563";
}

function formatAge(lastSeenStr: string): string {
  const ms = Date.now() - parseDate(lastSeenStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CoveragePage() {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tileCount, setTileCount] = useState(0);
  const [repeaterCount, setRepeaterCount] = useState(0);
  const [showCoverage, setShowCoverage] = useState(true);
  const [showRepeaters, setShowRepeaters] = useState(true);
  const [precision, setPrecision] = useState(6);
  const [days, setDays] = useState(7);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const coverageLayerRef = useRef<any>(null);
  const repeaterLayerRef = useRef<any>(null);
  const hoverLayerRef = useRef<any>(null);
  const coverageDataRef = useRef<CoverageTile[]>([]);
  const repeaterDataRef = useRef<Repeater[]>([]);
  const repeaterPosRef = useRef<Map<string, Array<[number, number]>>>(new Map());
  const repeaterToTilesRef = useRef<Map<string, CoverageTile[]>>(new Map());

  const getRepeaterLabels = useCallback((ids: string[]) => {
    return ids.flatMap((id) => {
      return repeaterDataRef.current
        .filter((repeater) => repeater.legacyId === id)
        .map((repeater) => repeater.id);
    });
  }, []);

  // ─── Layer render helpers ────────────────────────────────────────────────
  const renderCoverage = useCallback((tiles: CoverageTile[], show: boolean) => {
    const L = leafletRef.current;
    if (!L || !coverageLayerRef.current) return;
    coverageLayerRef.current.clearLayers();
    if (!show) return;
    tiles.forEach((tile) => {
      const [minLat, minLon, maxLat, maxLon] = geohashDecodeBbox(tile.hash);
      const tileLat = (minLat + maxLat) / 2;
      const tileLon = (minLon + maxLon) / 2;
      const ids: string[] = Array.isArray(tile.repeaters)
        ? (tile.repeaters as unknown as string[])
        : Object.keys(tile.repeaters ?? {});
      const repeaterLabels = getRepeaterLabels(ids);
      const color = tileColor(tile.received, tile.lost);
      const rect = L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.45,
      });
      const total = tile.received + tile.lost;
      const pct = total > 0 ? Math.round((tile.received / total) * 100) : 0;
      rect.bindPopup(
        `<b>${tile.hash}</b><br>` +
        `Received: ${tile.received}/${total} (${pct}%)<br>` +
        `Lost: ${tile.lost} &nbsp; Samples: ${tile.samples}<br>` +
        `Repeaters: ${repeaterLabels.join(", ") || ids.join(", ") || "—"}<br>` +
        `Updated: ${parseDate(tile.lastUpdate).toLocaleString()}`
      );
      rect.on("mouseover", () => {
        const hl = hoverLayerRef.current;
        if (!L || !hl) return;
        hl.clearLayers();
        L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
          color: "#f59e0b", weight: 3, fill: false, interactive: false,
        }).addTo(hl);
        ids.forEach((id) => {
          const positions = repeaterPosRef.current.get(id) ?? [];
          positions.forEach((pos) => {
            L.polyline([[pos[0], pos[1]], [tileLat, tileLon]], {
              color: "#3b82f6", weight: 2, opacity: 0.9, interactive: false,
            }).addTo(hl);
            L.circleMarker(pos, {
              radius: 12, color: "#f59e0b", weight: 3, fillColor: "#f59e0b", fillOpacity: 0.3, interactive: false,
            }).addTo(hl);
          });
        });
      });
      rect.on("mouseout", () => hoverLayerRef.current?.clearLayers());
      coverageLayerRef.current.addLayer(rect);
    });
  }, [getRepeaterLabels]);

  const renderRepeaters = useCallback((rptrs: Repeater[], show: boolean) => {
    const L = leafletRef.current;
    if (!L || !repeaterLayerRef.current) return;
    repeaterLayerRef.current.clearLayers();
    if (!show) return;
    rptrs.forEach((rptr) => {
      if (!rptr.lat || !rptr.lon) return;
      const color = repeaterColor(rptr.last_seen);
      const sz = 20;
      const marker = L.marker([rptr.lat, rptr.lon], {
        icon: L.divIcon({
          html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;box-sizing:border-box;font-family:monospace;">${rptr.id}</div>`,
          className: "",
          iconSize: [sz, sz],
          iconAnchor: [sz / 2, sz / 2],
          popupAnchor: [0, -sz / 2],
        }),
      });
      marker.bindPopup(
        `<b>${rptr.name || rptr.id}</b><br>` +
        `ID: <code>${rptr.id}</code><br>` +
        `Legacy ID: <code>${rptr.legacyId}</code><br>` +
        `Last seen: ${formatAge(rptr.last_seen)}`
      );
      marker.on("mouseover", () => {
        const hl = hoverLayerRef.current;
        if (!L || !hl) return;
        hl.clearLayers();
        L.circleMarker([rptr.lat, rptr.lon], {
          radius: 14, color: "#f59e0b", weight: 3, fillColor: "#f59e0b", fillOpacity: 0.3, interactive: false,
        }).addTo(hl);
        (repeaterToTilesRef.current.get(rptr.legacyId) ?? []).forEach((tile) => {
          const [minLat, minLon, maxLat, maxLon] = geohashDecodeBbox(tile.hash);
          const tileLat = (minLat + maxLat) / 2;
          const tileLon = (minLon + maxLon) / 2;
          L.polyline([[rptr.lat, rptr.lon], [tileLat, tileLon]], {
            color: "#3b82f6", weight: 2, opacity: 0.9, interactive: false,
          }).addTo(hl);
          L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
            color: "#f59e0b", weight: 2, fill: false, interactive: false,
          }).addTo(hl);
        });
      });
      marker.on("mouseout", () => hoverLayerRef.current?.clearLayers());
      repeaterLayerRef.current.addLayer(marker);
    });
  }, []);

  // ─── Load data ───────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    try {
      const resp = await fetch(`/api/coverage/get-nodes?precision=${precision}&days=${days}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { coverage, repeaters } = (await resp.json()) as {
        coverage: CoverageTile[];
        repeaters: Repeater[];
      };
      coverageDataRef.current = coverage;
      repeaterDataRef.current = repeaters;
      // Build hover lookup maps
      const posMap = new Map<string, Array<[number, number]>>();
      repeaters.forEach((r) => {
        if (!r.lat || !r.lon) return;
        const existing = posMap.get(r.legacyId) ?? [];
        existing.push([r.lat, r.lon]);
        posMap.set(r.legacyId, existing);
      });
      repeaterPosRef.current = posMap;
      const tileMap = new Map<string, CoverageTile[]>();
      coverage.forEach((tile) => {
        const rIds: string[] = Array.isArray(tile.repeaters)
          ? (tile.repeaters as unknown as string[])
          : Object.keys(tile.repeaters ?? {});
        rIds.forEach((id) => {
          if (!tileMap.has(id)) tileMap.set(id, []);
          tileMap.get(id)!.push(tile);
        });
      });
      repeaterToTilesRef.current = tileMap;
      setTileCount(coverage.length);
      setRepeaterCount(repeaters.length);
      renderCoverage(coverage, showCoverage);
      renderRepeaters(repeaters, showRepeaters);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error("Coverage load failed", e);
    } finally {
      setLoading(false);
    }
  }

  // ─── Map init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;
    let isMounted = true;

    (async () => {
      const cssHref = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      if (!document.querySelector(`link[href="${cssHref}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        document.head.appendChild(link);
      }

      const mod = await import("leaflet");
      const L = (mod as any).default || mod;
      if (!isMounted || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [45.0467, 38.996],
        zoom: 12,
        worldCopyJump: true,
        attributionControl: false,
      });
      mapRef.current = map;
      leafletRef.current = L;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      coverageLayerRef.current = L.layerGroup().addTo(map);
      repeaterLayerRef.current = L.layerGroup().addTo(map);
      hoverLayerRef.current = L.layerGroup().addTo(map);

      if (isMounted) await loadData();
    })();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
        leafletRef.current = null;
        coverageLayerRef.current = null;
        repeaterLayerRef.current = null;
        hoverLayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Toggle effects (re-render cached data when layer visibility changes) ─
  useEffect(() => {
    renderCoverage(coverageDataRef.current, showCoverage);
  }, [renderCoverage, showCoverage]);

  useEffect(() => {
    renderRepeaters(repeaterDataRef.current, showRepeaters);
  }, [renderRepeaters, showRepeaters]);

  // ─── Reload when precision changes (skip on first mount) ─────────────────
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (leafletRef.current) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precision, days]);

  // ─── Render ──────────────────────────────────────────────────────────────
  const COVERAGE_LEGEND = [
    { color: "#4ade80", label: "≥80% received" },
    { color: "#facc15", label: "50–79%" },
    { color: "#fb923c", label: "20–49%" },
    { color: "#f87171", label: "<20%" },
    { color: "#94a3b8", label: "No data" },
  ];

  const REPEATER_LEGEND = [
    { color: "#3b82f6", label: "Active (<1 day)" },
    { color: "#94a3b8", label: "Stale (1–5 days)" },
    { color: "#4b5563", label: "Inactive (>5 days)" },
  ];

  return (
    <AppPageShell fill padding="none" variant="none" width="full">
      <div
        className="flex flex-col md:flex-row bg-gray-50 dark:bg-neutral-900 text-gray-900 dark:text-gray-100 overflow-hidden"
        style={{ height: "calc(100dvh - var(--header-height))" }}
      >
      {/* ── Map (top on mobile, right on desktop) ── */}
      <div className="order-1 md:order-2 flex-1 relative min-h-0">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Map legend overlay */}
        {/* <div className="absolute bottom-4 left-4 bg-white/95 dark:bg-neutral-900/95 text-xs text-gray-700 dark:text-gray-300 dark:text-gray-300 rounded shadow p-2 z-[1000] pointer-events-none border border-gray-200 dark:border-neutral-700">
          <div className="font-semibold mb-1">Coverage</div>
          {COVERAGE_LEGEND.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1 mt-0.5">
              <span style={{ display: "inline-block", width: 10, height: 10, background: color, border: "1px solid #ccc", borderRadius: 2 }} />
              {label}
            </div>
          ))}
          <div className="font-semibold mt-2 mb-1">Repeaters</div>
          {REPEATER_LEGEND.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1 mt-0.5">
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color, border: "1px solid #888" }} />
              {label}
            </div>
          ))}
        </div> */}
      </div>

      {/* ── Panel (bottom on mobile, left on desktop) ── */}
      <div
        className={`order-2 md:order-1 flex flex-col bg-white dark:bg-neutral-900 border-t md:border-t-0 md:border-r border-gray-200 dark:border-neutral-700 md:w-72 md:flex-shrink-0 overflow-hidden md:max-h-none ${mobilePanelOpen ? "max-h-[60vh]" : "max-h-[3.25rem]"}`}
      >
        {/* Mobile compact bar */}
        <div className="md:hidden flex items-center justify-between px-4 h-[3.25rem] flex-shrink-0 border-b border-gray-100 dark:border-neutral-800">
          <span className="text-sm font-bold">🗺️ Coverage Map</span>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="px-2 py-1.5 text-xs rounded bg-blue-600 text-white disabled:opacity-40"
            >
              {loading ? "…" : "Refresh"}
            </button>
            <button
              onClick={() => setMobilePanelOpen((v) => !v)}
              className="p-1 text-gray-500 dark:text-gray-400 text-base leading-none"
              aria-label="Toggle panel"
            >
              {mobilePanelOpen ? "▾" : "▴"}
            </button>
          </div>
        </div>

        {/* Full panel content */}
        <div className="overflow-y-auto flex-1">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-neutral-700">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 hidden md:block">🗺️ Coverage Map</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-0.5">
              Community mesh coverage from wardrive data.
            </p>
            <button
              onClick={loadData}
              disabled={loading}
              className="mt-2 w-full px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            {lastRefreshed && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                Updated {lastRefreshed.toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="p-4 border-b border-gray-200 dark:border-neutral-700">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Stats</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 dark:bg-neutral-800 rounded p-2">
                <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{tileCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Coverage tiles</div>
              </div>
              <div className="bg-gray-50 dark:bg-neutral-800 rounded p-2">
                <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{repeaterCount}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Repeaters</div>
              </div>
            </div>
          </div>

          {/* Precision selector */}
          <div className="p-4 border-b border-gray-200 dark:border-neutral-700">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Precision</h2>
            <select
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
              className="w-full text-xs rounded border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-700 dark:text-gray-300 px-2 py-1.5"
            >
              <option value={4}>4 — ±20 km</option>
              <option value={5}>5 — ±2.4 km</option>
              <option value={6}>6 — ±610 m</option>
              <option value={7}>7 — ±76 m</option>
              <option value={8}>8 — ±19 m</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Tile size — reloads automatically.</p>
          </div>

          {/* Date range */}
          <div className="p-4 border-b border-gray-200 dark:border-neutral-700">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Date Range</h2>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full text-xs rounded border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-700 dark:text-gray-300 px-2 py-1.5"
            >
              <option value={1}>Last 1 day</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={0}>All time</option>
            </select>
          </div>

          {/* Layer toggles */}
          <div className="p-4 border-b border-gray-200 dark:border-neutral-700">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Layers</h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCoverage}
                  onChange={(e) => setShowCoverage(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">Coverage tiles</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRepeaters}
                  onChange={(e) => setShowRepeaters(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">Repeaters</span>
              </label>
            </div>
          </div>

          {/* Legend */}
          <div className="p-4">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Legend</h2>
            <div className="space-y-1">
              {COVERAGE_LEGEND.map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span style={{ display: "inline-block", width: 12, height: 12, background: color, border: "1px solid #ccc", borderRadius: 2 }} />
                  {label}
                </div>
              ))}
              <p className="text-xs font-medium text-gray-600 mt-2 mb-1">Repeaters</p>
              {REPEATER_LEGEND.map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: color, border: "1px solid #888" }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppPageShell>
  );
}
