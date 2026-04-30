"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  geohashDecodeBbox,
  geohashDecodeCenter,
  haversineKm,
  sampleKey,
} from "@/lib/wardrive/geohash";

// ─── Constants ────────────────────────────────────────────────────────────────
const WARDRIVE_CHANNEL_NAME = "#wardrive";
const WARDRIVE_CHANNEL_KEY = new Uint8Array([
  0x40, 0x76, 0xc3, 0x15, 0xc1, 0xef, 0x38, 0x5f,
  0xa9, 0x3f, 0x06, 0x60, 0x27, 0x32, 0x0f, 0xe5,
]);
const LOG_KEY = "meshcoreWardriveLogV1";
const IGNORED_ID_KEY = "meshcoreWardriveIgnoredIdV1";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogEntry {
  timestamp: string;
  lat: number;
  lon: number;
  mode: string;
  distanceKm: number | null;
  skipped?: boolean;
  sentToMesh: boolean;
  sentToService: boolean;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatLocal(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not available"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 5000,
    });
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WardrivePage() {
  // ── UI State ────────────────────────────────────────────────────
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [statusColor, setStatusColor] = useState("text-red-600");
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [channelInfo, setChannelInfo] = useState("");

  const [currentTile, setCurrentTile] = useState("none");
  const [tileNeedsPing, setTileNeedsPing] = useState<boolean | null>(null);
  const [lastSampleText, setLastSampleText] = useState("None yet");

  const [pingMode, setPingMode] = useState<"fill" | "interval">("fill");
  const [fillPrecision, setFillPrecision] = useState(6);
  const [intervalVal, setIntervalVal] = useState("0.5");
  const [minDistVal, setMinDistVal] = useState("0.5");
  const [running, setRunning] = useState(false);
  const [ignoredId, setIgnoredId] = useState<string | null>(null);
  const [ignoredIdDisplay, setIgnoredIdDisplay] = useState("None");

  const [log, setLog] = useState<LogEntry[]>([]);

  // ── Internal Refs (avoid stale closures) ────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null); // stores the Leaflet L instance after dynamic import
  const mapRef = useRef<any>(null);
  const coverageLayerRef = useRef<any>(null);
  const posMarkerRef = useRef<any>(null);
  const connectionRef = useRef<any>(null);
  const wardriveChannelRef = useRef<any>(null);
  const coveredTilesRef = useRef<Set<string>>(new Set());
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleRef = useRef<{ lat: number; lon: number; timestamp: string } | null>(null);
  const currentPosRef = useRef<[number, number]>([0, 0]);
  const lastPosUpdateRef = useRef<number>(0);
  const runningRef = useRef(false);
  const pingModeRef = useRef<"fill" | "interval">("fill");
  const fillPrecisionRef = useRef(6);
  const intervalValRef = useRef("0.5");
  const minDistValRef = useRef("0.5");
  const ignoredIdRef = useRef<string | null>(null);

  // keep refs in sync
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { pingModeRef.current = pingMode; }, [pingMode]);
  useEffect(() => { fillPrecisionRef.current = fillPrecision; }, [fillPrecision]);
  useEffect(() => { intervalValRef.current = intervalVal; }, [intervalVal]);
  useEffect(() => { minDistValRef.current = minDistVal; }, [minDistVal]);
  useEffect(() => { ignoredIdRef.current = ignoredId; }, [ignoredId]);

  // ── Status helper ───────────────────────────────────────────────
  function setStatusMsg(text: string, color = "text-gray-600") {
    setStatus(text);
    setStatusColor(color);
  }

  // ── Map Init ────────────────────────────────────────────────────
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

      // Guard against Strict-Mode double-invoke or container already initialized
      if (!isMounted || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [45, 38],
        zoom: 10,
        worldCopyJump: true,
        zoomControl: true,
        attributionControl: false,
      });
      mapRef.current = map;
      leafletRef.current = L;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      coverageLayerRef.current = L.layerGroup().addTo(map);

      posMarkerRef.current = L.circleMarker([0, 0], {
        radius: 7,
        weight: 2,
        color: "#ff2222",
        fillColor: "#ff5555",
        fillOpacity: 0.95,
      });
    })();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
        leafletRef.current = null;
        coverageLayerRef.current = null;
        posMarkerRef.current = null;
      }
    };
  }, []);

  // ── Persist / Load Log & IgnoredId ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (raw) setLog(JSON.parse(raw));
    } catch {}
    try {
      const id = localStorage.getItem(IGNORED_ID_KEY);
      setIgnoredId(id || null);
      setIgnoredIdDisplay(id || "None");
    } catch {}
  }, []);

  function addLogEntry(entry: LogEntry) {
    setLog((prev) => {
      const next = [...prev, entry].slice(-50);
      try { localStorage.setItem(LOG_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ── Coverage helpers ─────────────────────────────────────────────
  function addCoverageBox(tileId: string) {
    const L = leafletRef.current;
    if (!L || !coverageLayerRef.current || !mapRef.current) return;
    const [minLat, minLon, maxLat, maxLon] = geohashDecodeBbox(tileId);
    const rect = L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
      color: "#FFAB77",
      weight: 1,
      fillOpacity: 0.35,
    });
    coverageLayerRef.current.addLayer(rect);
  }

  function redrawCoverage() {
    if (!coverageLayerRef.current) return;
    coverageLayerRef.current.clearLayers();
    coveredTilesRef.current.forEach((t) => addCoverageBox(t));
  }

  async function refreshCoverageData() {
    try {
      const resp = await fetch(`/api/wardrive/get-coverage?precision=${fillPrecisionRef.current}`);
      if (!resp.ok) return;
      const tiles: string[] = await resp.json();
      coveredTilesRef.current = new Set(tiles);
      redrawCoverage();
    } catch (e) {
      console.error("Coverage fetch failed", e);
    }
  }

  // ── Location tracking ────────────────────────────────────────────
  async function updateCurrentPosition() {
    try {
      const pos = await getCurrentPosition();
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      currentPosRef.current = [lat, lon];
      lastPosUpdateRef.current = Date.now();

      if (posMarkerRef.current && mapRef.current) {
        if (!mapRef.current.hasLayer(posMarkerRef.current)) {
          posMarkerRef.current.addTo(mapRef.current);
        }
        posMarkerRef.current.setLatLng([lat, lon]);
        mapRef.current.panTo([lat, lon]);
      }

      const tile = sampleKey(lat, lon).substring(0, fillPrecisionRef.current);
      setCurrentTile(tile);
      setTileNeedsPing(!coveredTilesRef.current.has(tile));
    } catch (e) {
      console.warn("Geolocation failed", e);
    }
  }

  function startLocationTracking() {
    stopLocationTracking();
    updateCurrentPosition();
    locationTimerRef.current = setInterval(updateCurrentPosition, 2000);
  }

  function stopLocationTracking() {
    if (locationTimerRef.current) {
      clearInterval(locationTimerRef.current);
      locationTimerRef.current = null;
    }
  }

  async function ensurePositionFresh() {
    if (Date.now() - lastPosUpdateRef.current > 3000) {
      await updateCurrentPosition();
    }
  }

  // ── WakeLock ─────────────────────────────────────────────────────
  const wakeLockRef = useRef<any>(null);

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch {}
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
  }

  // ── BLE helpers ──────────────────────────────────────────────────
  async function ensureWardriveChannel() {
    if (!connectionRef.current) throw new Error("Not connected");
    if (wardriveChannelRef.current) return wardriveChannelRef.current;

    let channel = await connectionRef.current.findChannelByName(WARDRIVE_CHANNEL_NAME);
    if (!channel) {
      const ok = window.confirm(
        `Channel "${WARDRIVE_CHANNEL_NAME}" not found. Create it now?`
      );
      if (!ok) throw new Error("Channel not created");

      const channels = await connectionRef.current.getChannels();
      let idx = 0;
      while (idx < channels.length && channels[idx]?.name !== "") idx++;
      if (idx >= channels.length) throw new Error("No free channel slots");

      await connectionRef.current.setChannel(idx, WARDRIVE_CHANNEL_NAME, WARDRIVE_CHANNEL_KEY);
      channel = { channelIdx: idx, name: WARDRIVE_CHANNEL_NAME };
    }

    setChannelInfo(`Using ${channel.name} on slot ${channel.channelIdx}`);
    wardriveChannelRef.current = channel;
    return channel;
  }

  // ── Ping logic ───────────────────────────────────────────────────
  async function sendPing({ auto = false } = {}) {
    if (!connectionRef.current) { setStatusMsg("Not connected", "text-red-600"); return; }

    let channel: any;
    try { channel = await ensureWardriveChannel(); }
    catch (e: any) { setStatusMsg(`No #wardrive channel`, "text-amber-600"); return; }

    try { await ensurePositionFresh(); }
    catch (e) { setStatusMsg("Get location failed", "text-amber-600"); return; }

    const [rawLat, rawLon] = currentPosRef.current;
    if (rawLat === 0 && rawLon === 0) { setStatusMsg("No GPS fix yet", "text-amber-600"); return; }

    const sid = sampleKey(rawLat, rawLon);
    const coverageTileId = sid.substring(0, fillPrecisionRef.current);
    const [lat, lon] = geohashDecodeCenter(sid);
    let distanceKmValue: number | null = null;

    if (pingModeRef.current === "interval") {
      const minKm = parseFloat(minDistValRef.current || "0.5");
      if (auto && lastSampleRef.current && minKm > 0) {
        distanceKmValue = haversineKm(
          [lastSampleRef.current.lat, lastSampleRef.current.lon], [lat, lon]
        );
        if (distanceKmValue < minKm) {
          setStatusMsg("Skipped (min dist)", "text-amber-600");
          addLogEntry({ timestamp: new Date().toISOString(), lat, lon, mode: "auto", distanceKm: distanceKmValue, skipped: true, sentToMesh: false, sentToService: false, notes: "" });
          return;
        }
      }
    } else {
      if (auto && coveredTilesRef.current.has(coverageTileId)) {
        setStatusMsg("No ping needed", "text-amber-600");
        return;
      }
    }

    setStatusMsg("Sending ping…", "text-sky-600");

    let text = `${lat.toFixed(4)} ${lon.toFixed(4)}`;
    if (ignoredIdRef.current) text += ` ${ignoredIdRef.current}`;

    let sentToMesh = false, sentToService = false, notes = "";

    try {
      await connectionRef.current.sendChannelTextMessage(channel.channelIdx, text);
      sentToMesh = true;
    } catch (e: any) {
      notes = "Mesh fail: " + e.message;
      setStatusMsg("Mesh send failed", "text-red-600");
    }

    if (sentToMesh) {
      try {
        await fetch("/api/wardrive/put-sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lon }),
        });
        sentToService = true;
      } catch (e: any) {
        notes = "Service fail: " + e.message;
      }

      const nowIso = new Date().toISOString();
      lastSampleRef.current = { lat, lon, timestamp: nowIso };
      setLastSampleText(`${lat.toFixed(4)}, ${lon.toFixed(4)} @ ${formatLocal(nowIso)}`);

      if (!coveredTilesRef.current.has(coverageTileId)) {
        coveredTilesRef.current.add(coverageTileId);
        setTileNeedsPing(false);
        addCoverageBox(coverageTileId);
      }
      setStatusMsg(auto ? "Auto ping sent" : "Ping sent ✓", "text-emerald-600");
    }

    addLogEntry({ timestamp: new Date().toISOString(), lat, lon, mode: auto ? "auto" : "manual", distanceKm: distanceKmValue, sentToMesh, sentToService, notes });
  }

  // ── Auto ping ─────────────────────────────────────────────────────
  function stopAutoPing() {
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
    runningRef.current = false;
    setRunning(false);
    releaseWakeLock();
  }

  async function startAutoPing() {
    if (!connectionRef.current) { alert("Connect to a MeshCore device first."); return; }
    stopAutoPing();
    runningRef.current = true;
    setRunning(true);

    await refreshCoverageData();
    setStatusMsg("Auto mode started", "text-emerald-600");

    let intervalMs = 10_000;
    if (pingModeRef.current === "interval") {
      intervalMs = parseFloat(intervalValRef.current || "0.5") * 60_000;
    }

    sendPing({ auto: true }).catch(console.error);
    autoTimerRef.current = setInterval(() => {
      sendPing({ auto: true }).catch(console.error);
    }, intervalMs);

    await acquireWakeLock();
  }

  // ── BLE connection handlers ───────────────────────────────────────
  async function handleConnect() {
    if (connectionRef.current) return;
    if (!("bluetooth" in navigator)) {
      alert("Web Bluetooth is not supported in this browser.\nUse Chrome on Android or desktop, or Bluefy on iOS.");
      return;
    }

    setStatusMsg("Connecting…", "text-sky-600");

    try {
      const { WebBleConnection } = await import("@liamcottle/meshcore.js");
      const conn = await WebBleConnection.open();
      connectionRef.current = conn;

      conn.on("connected", async () => {
        setConnected(true);
        setStatusMsg("Connected (syncing…)", "text-emerald-600");

        try { await conn.syncDeviceTime(); } catch {}
        try {
          const info = await conn.getSelfInfo();
          setDeviceName(info?.name ? `Device: ${info.name}` : "Device connected");
          setStatusMsg(`Connected to ${info?.name ?? "MeshCore"}`, "text-emerald-600");
        } catch {}
        try { await ensureWardriveChannel(); } catch {}

        startLocationTracking();
      });

      conn.on("disconnected", () => {
        stopAutoPing();
        stopLocationTracking();
        setConnected(false);
        setDeviceName("");
        setChannelInfo("");
        connectionRef.current = null;
        wardriveChannelRef.current = null;
        setStatusMsg("Disconnected", "text-red-600");
      });
    } catch (e: any) {
      console.error("BLE connect failed", e);
      setStatusMsg("Failed to connect", "text-red-600");
    }
  }

  async function handleDisconnect() {
    stopAutoPing();
    stopLocationTracking();
    try { await connectionRef.current?.close(); } catch {}
  }

  function handlePromptIgnoredId() {
    const id = prompt("Enter repeater id to ignore (2 hex digits), or leave blank to clear:", ignoredId ?? "");
    if (id === null) return;
    if (id && id.length !== 2) { alert("Must be exactly 2 hex digits."); return; }
    const val = id || null;
    setIgnoredId(val);
    setIgnoredIdDisplay(val ?? "None");
    try { localStorage.setItem(IGNORED_ID_KEY, id); } catch {}
  }

  // ── Cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopAutoPing();
      stopLocationTracking();
      releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Visibility change ─────────────────────────────────────────────
  useEffect(() => {
    const handler = async () => {
      if (document.hidden) {
        releaseWakeLock();
        stopLocationTracking();
      } else {
        if (connected) startLocationTracking();
        if (runningRef.current) await acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Render ────────────────────────────────────────────────────────
  const displayedLog = [...log].reverse().slice(0, 50);

  return (
    <div
      className="flex flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-neutral-900 dark:text-gray-100 md:flex-row"
      style={{ height: 'calc(100dvh - var(--header-height))' }}
    >
      <div className="order-1 relative min-h-0 flex-1 md:order-2">
        <div ref={mapContainerRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded border border-gray-200 bg-white/95 p-2 text-xs text-gray-700 shadow dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-gray-300">
          <div className="mb-1 font-semibold">Coverage</div>
          <div className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 12, height: 12, background: "#FFAB77", border: "1px solid #ccc" }} />
            Covered tile
          </div>
          <div className="mt-1 flex items-center gap-1">
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#ff5555", border: "2px solid #ff2222" }} />
            Your position
          </div>
          <div className="mt-2 text-gray-400">Must remain in foreground with screen on.</div>
          <div className="text-gray-400">Does not work in Safari. Use Bluefy on iOS.</div>
        </div>
      </div>

      <div
        className={`order-2 flex max-h-[3.25rem] flex-col overflow-hidden border-t border-gray-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 md:order-1 md:w-80 md:max-h-none md:flex-shrink-0 md:border-r md:border-t-0 ${mobilePanelOpen ? "max-h-[60vh]" : "max-h-[3.25rem]"}`}
      >
        <div className="flex h-[3.25rem] flex-shrink-0 items-center justify-between border-b border-gray-100 px-4 dark:border-neutral-800 md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-bold">Wardrive</span>
            <span className={`truncate text-xs font-semibold ${statusColor}`}>{status}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {!connected ? (
              <button
                onClick={handleConnect}
                className="rounded bg-blue-600 px-2 py-1.5 text-xs text-white"
              >
                Connect
              </button>
            ) : (
              <>
                <button
                  onClick={() => sendPing({ auto: false }).catch(console.error)}
                  className="rounded bg-indigo-600 px-2 py-1.5 text-xs text-white"
                >
                  Ping
                </button>
                <button
                  onClick={() => running ? stopAutoPing() : startAutoPing().catch(console.error)}
                  className={`rounded px-2 py-1.5 text-xs text-white ${running ? "bg-amber-500" : "bg-indigo-600"}`}
                >
                  {running ? "Stop" : "Auto"}
                </button>
              </>
            )}
            <button
              onClick={() => setMobilePanelOpen((value) => !value)}
              className="p-1 text-base leading-none text-gray-500 dark:text-gray-400"
              aria-label="Toggle panel"
            >
              {mobilePanelOpen ? "v" : "^"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-gray-200 p-4 dark:border-neutral-700">
            <h1 className="hidden text-lg font-bold text-gray-900 dark:text-gray-100 md:block">MeshCore Wardrive</h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Sends location to #wardrive to build the coverage map.</p>
            <div className="mt-2 hidden text-sm font-semibold md:block">
              Status: <span className={statusColor}>{status}</span>
            </div>
            {deviceName && <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{deviceName}</div>}
            {channelInfo && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{channelInfo}</div>}
          </div>

          <div className="border-b border-gray-200 p-4 dark:border-neutral-700">
            <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Current Tile</h2>
            <div className="text-xs text-gray-600 dark:text-gray-400">Geohash: <span className="font-mono text-gray-900 dark:text-gray-100">{currentTile}</span></div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Needs Ping:{" "}
              {tileNeedsPing === null ? "n/a" : tileNeedsPing ? "Yes" : "No"}
            </div>
          </div>

          <div className="border-b border-gray-200 p-4 dark:border-neutral-700">
            <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Connection</h2>
            <div className="flex gap-2">
              <button
                onClick={handleConnect}
                disabled={connected}
                className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Connect via BLE
              </button>
              <button
                onClick={handleDisconnect}
                disabled={!connected}
                className="flex-1 rounded bg-gray-200 px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-700 dark:text-gray-200 dark:hover:bg-neutral-600"
              >
                Disconnect
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Requires Bluetooth and Location permissions.</p>
          </div>

          {connected && (
            <div className="space-y-3 border-b border-gray-200 p-4 dark:border-neutral-700">
              <h2 className="text-xs font-semibold uppercase text-gray-500">Ping Controls</h2>

              <div className="flex gap-2">
                <button
                  onClick={() => running ? stopAutoPing() : startAutoPing().catch(console.error)}
                  className={`flex-1 rounded px-3 py-1.5 text-xs text-white ${running ? "bg-amber-500 hover:bg-amber-400" : "bg-indigo-600 hover:bg-indigo-500"}`}
                >
                  {running ? "Stop Auto" : "Start Auto"}
                </button>
              </div>

              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400">Auto Ping Mode</label>
                <select
                  value={pingMode}
                  onChange={(event) => {
                    const value = event.target.value as "fill" | "interval";
                    setPingMode(value);
                    if (running) stopAutoPing();
                  }}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
                >
                  <option value="fill">Fill Missing Tiles</option>
                  <option value="interval">Interval</option>
                </select>
              </div>

              {pingMode === "fill" && (
                <div>
                  <label className="text-xs text-gray-600 dark:text-gray-400">Tile Precision</label>
                  <select
                    value={fillPrecision}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setFillPrecision(value);
                      fillPrecisionRef.current = value;
                      coveredTilesRef.current = new Set();
                      redrawCoverage();
                      if (running) stopAutoPing();
                    }}
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
                  >
                    <option value={4}>4 - +/-20 km</option>
                    <option value={5}>5 - +/-2.4 km</option>
                    <option value={6}>6 - +/-610 m</option>
                    <option value={7}>7 - +/-76 m</option>
                    <option value={8}>8 - +/-19 m</option>
                  </select>
                </div>
              )}

              {pingMode === "interval" && (
                <>
                  <div>
                    <label className="text-xs text-gray-600 dark:text-gray-400">Ping Interval</label>
                    <select
                      value={intervalVal}
                      onChange={(event) => setIntervalVal(event.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
                    >
                      <option value="1">Every 1 minute</option>
                      <option value="2">Every 2 minutes</option>
                      <option value="5">Every 5 minutes</option>
                      <option value="10">Every 10 minutes</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 dark:text-gray-400">Min Distance</label>
                    <select
                      value={minDistVal}
                      onChange={(event) => setMinDistVal(event.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
                    >
                      <option value="0.5">0.5 km</option>
                      <option value="1">1 km</option>
                      <option value="2">2 km</option>
                      <option value="5">5 km</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <span className="text-xs text-gray-600 dark:text-gray-400">Last Ping: </span>
                <span className="text-xs text-gray-900 dark:text-gray-100">{lastSampleText}</span>
              </div>
            </div>
          )}

          <div className="border-b border-gray-200 p-4 dark:border-neutral-700">
            <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Ignored Repeater</h2>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">If you are using a mobile repeater, ignore its id.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePromptIgnoredId}
                className="rounded bg-gray-200 px-3 py-1 text-xs text-gray-800 hover:bg-gray-300 dark:bg-neutral-700 dark:text-gray-200 dark:hover:bg-neutral-600"
              >
                Set
              </button>
              <span className="font-mono text-xs text-gray-900 dark:text-gray-100">{ignoredIdDisplay}</span>
            </div>
          </div>

          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Log</h2>
              <button
                onClick={() => {
                  if (!confirm("Clear local wardrive log?")) return;
                  setLog([]);
                  lastSampleRef.current = null;
                  setLastSampleText("None yet");
                  try { localStorage.removeItem(LOG_KEY); } catch {}
                }}
                className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
              >
                Clear
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-700 dark:text-gray-300" style={{ minWidth: 260 }}>
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 dark:border-neutral-700">
                    <th className="pb-1 text-left">Time</th>
                    <th className="pb-1 text-left">Mode</th>
                    <th className="pb-1 text-center">Mesh</th>
                    <th className="pb-1 text-center">Svc</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedLog.map((entry, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800">
                      <td className="whitespace-nowrap py-0.5 pr-1">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-0.5 pr-1">
                        {entry.skipped ? <span className="text-gray-400 dark:text-gray-500">skip</span> : entry.mode}
                      </td>
                      <td className="py-0.5 text-center">
                        {entry.sentToMesh ? "yes" : entry.skipped ? "-" : "no"}
                      </td>
                      <td className="py-0.5 text-center">
                        {entry.sentToService ? "yes" : entry.skipped ? "-" : "no"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {displayedLog.length === 0 && (
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">No log entries yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
