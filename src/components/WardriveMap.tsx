"use client";
import React, { useEffect, useRef, useState } from "react";
// Load Leaflet only on the client to avoid server-side references

type WardriveMapProps = {
  dataUrl?: string; // endpoint to fetch coverage/samples
};

const defaultDataUrl = '/api/samples';

// Minimal geohash utilities ported from meshwar-map
const Geohash = {
  base32: '0123456789bcdefghjkmnpqrstuvwxyz',
  encode(lat: number, lon: number, precision: number) {
    let idx = 0, bit = 0, evenBit = true;
    let geohash = '';
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    while (geohash.length < precision) {
      if (evenBit) {
        const lonMid = (lonMin + lonMax) / 2;
        if (lon > lonMid) { idx |= (1 << (4 - bit)); lonMin = lonMid; } else { lonMax = lonMid; }
      } else {
        const latMid = (latMin + latMax) / 2;
        if (lat > latMid) { idx |= (1 << (4 - bit)); latMin = latMid; } else { latMax = latMid; }
      }
      evenBit = !evenBit;
      if (bit < 4) { bit++; } else { geohash += Geohash.base32[idx]; bit = 0; idx = 0; }
    }
    return geohash;
  },
  bounds(geohash: string) {
    let evenBit = true;
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    for (let i = 0; i < geohash.length; i++) {
      const idx = Geohash.base32.indexOf(geohash[i]);
      for (let n = 4; n >= 0; n--) {
        const bitN = (idx >> n) & 1;
        if (evenBit) {
          const lonMid = (lonMin + lonMax) / 2;
          if (bitN === 1) { lonMin = lonMid; } else { lonMax = lonMid; }
        } else {
          const latMid = (latMin + latMax) / 2;
          if (bitN === 1) { latMin = latMid; } else { latMax = latMid; }
        }
        evenBit = !evenBit;
      }
    }
    return { sw: { lat: latMin, lon: lonMin }, ne: { lat: latMax, lon: lonMax } };
  }
};

export default function WardriveMap({ dataUrl = defaultDataUrl }: WardriveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const coverageLayerRef = useRef<L.LayerGroup | null>(null);
  const [loadingText, setLoadingText] = useState('Loading wardrive data...');
  const [isDark, setIsDark] = useState(true);
  const [precision, setPrecision] = useState(7); // geohash length (coverage resolution)

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;
    let map: any = null;
    let coverageLayer: any = null;
    let tileLayer: any = null;

    // Load Leaflet and CSS in browser only
    (async function init() {
      if (typeof window === 'undefined') return;
      // inject Leaflet CSS
      const cssHref = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      if (!document.querySelector(`link[href="${cssHref}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssHref;
        document.head.appendChild(link);
      }

      const mod = await import('leaflet');
      const L = (mod && (mod as any).default) || mod;

      map = L.map(containerRef.current!, {
        center: [45.0355, 38.9756],
        zoom: 10,
        maxBounds: [[-90, -180], [90, 180]],
        maxBoundsViscosity: 1.0,
      });
      mapRef.current = map;

      function updateTiles() {
        if (tileLayer && map.hasLayer(tileLayer)) map.removeLayer(tileLayer);
        if (isDark) {
          tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 19 });
        } else {
          tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 });
        }
        tileLayer.addTo(map);
      }
      updateTiles();

      coverageLayer = L.layerGroup().addTo(map);
      coverageLayerRef.current = coverageLayer;

      // helpers
      function geohashToBounds(hash: string) {
        const b = Geohash.bounds(hash);
        return [[b.sw.lat, b.sw.lon] as [number, number], [b.ne.lat, b.ne.lon] as [number, number]];
      }

      function ageInDays(timestamp: string | number) {
        const now = new Date();
        const sampleDate = new Date(timestamp);
        const diffMs = now.getTime() - sampleDate.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }

      function getFreshnessStatus(daysOld: number) {
        if (daysOld <= 7) return { label: '🟢 Live Coverage', color: '#00ff00', opacity: 1.0, dashArray: null };
        if (daysOld <= 30) return { label: `🟡 Recent Coverage (${daysOld} days ago)`, color: '#ffff00', opacity: 0.8, dashArray: null };
        return { label: `⚪ Last Known Coverage (${daysOld} days ago)`, color: '#888888', opacity: 0.6, dashArray: '5,5' };
      }

      function getCoverageColor(received: number, lost: number) {
        const total = received + lost;
        if (total === 0) return '#cccccc';
        const successRate = received / total;
        if (successRate >= 0.8) return '#00ff00';
        if (successRate >= 0.5) return '#88ff00';
        if (successRate >= 0.3) return '#ffff00';
        if (successRate >= 0.1) return '#ffaa00';
        return '#ff0000';
      }

      function renderCoverage(storedCoverage: Record<string, any>) {
        coverageLayer.clearLayers();
        Object.entries(storedCoverage).forEach(([hash, cellAny]) => {
          const cell: any = cellAny;
          const bounds = geohashToBounds(hash);
          const daysOld = ageInDays(cell.lastUpdate);
          const freshness = getFreshnessStatus(daysOld);
          const color = getCoverageColor(cell.received || 0, cell.lost || 0);

          const rect = L.rectangle(bounds, { color, fillColor: color, weight: 2, opacity: freshness.opacity, fillOpacity: freshness.opacity * 0.3, dashArray: freshness.dashArray || undefined });

          const successRate = cell.received + cell.lost > 0 ? ((cell.received / (cell.received + cell.lost)) * 100).toFixed(1) : '0';
          let repeatersHtml = 'None';
          if (cell.repeaters && typeof cell.repeaters === 'object') {
            const repeaterList = Object.values(cell.repeaters).map((rep: any) => {
              const escapedName = (rep.name || 'Unknown').replace(/'/g, "\\'");
              return `<span class="repeater-link" onclick="console.log('repeater click')" title="Click for details">${rep.name}</span>`;
            });
            if (repeaterList.length > 0) repeatersHtml = repeaterList.join(', ');
          }

          const popup = `
            <div class="popup-content">
              <div style="color:${freshness.color}; font-weight:bold; margin-bottom:8px;">${freshness.label}</div>
              <div><span class="popup-label">Success Rate:</span> ${successRate}%</div>
              <div><span class="popup-label">Received:</span> ${Math.round(cell.received || 0)}</div>
              <div><span class="popup-label">Lost:</span> ${Math.round(cell.lost || 0)}</div>
              <div><span class="popup-label">Samples:</span> ${cell.samples || 0}</div>
              <div><span class="popup-label">Repeaters:</span> ${repeatersHtml}</div>
              <div style="font-size:10px;color:#888;margin-top:4px;">Click repeater name for signal details</div>
              <div><span class="popup-label">Last Update:</span> ${new Date(cell.lastUpdate).toLocaleDateString()}</div>
            </div>
          `;
          rect.bindPopup(popup);
          coverageLayer.addLayer(rect);
        });
      }

      async function loadData() {
        try {
          setLoadingText('Loading wardrive data...');
          const res = await fetch(`${dataUrl}?precision=${precision}`);
          const data = await res.json();
          if (!mounted) return;
          if (!data || !data.coverage) {
            setLoadingText('No coverage data found');
            return;
          }
          renderCoverage(data.coverage);
          setLoadingText('');
        } catch (e) {
          console.error('Error loading wardrive data', e);
          setLoadingText('Error loading data');
        }
      }

      loadData();
      const refreshInterval = setInterval(loadData, 30000);

      // cleanup when Leaflet is initialized
      return () => {
        mounted = false;
        clearInterval(refreshInterval);
        try { if (map) map.remove(); } catch (e) {}
      };
    })();

    return () => {
      // outer cleanup
      try { if (mapRef.current) mapRef.current.remove(); } catch (e) {}
    };
  }, [dataUrl, isDark, precision]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>{`
        .wardrive-info { position: absolute; top: 10px; left: 10px; background: rgba(30,30,30,0.95); padding: 12px; border-radius:8px; z-index:1000; color:#fff; min-width:220px }
        .wardrive-legend { margin-top:8px; font-size:12px; color:#aaa }
        .repeater-link { color:#00e676; cursor:pointer; text-decoration:underline }
        .loading { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#00e676; z-index:2000 }
      `}</style>
      {loadingText && <div className="loading">{loadingText}</div>}
      <div className="wardrive-info">
        <h3 style={{ margin: 0, marginBottom: 8 }}>📡 MeshCore Wardrive</h3>
        <div style={{ fontSize: 13 }}>Auto-refreshing wardrive coverage</div>
        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize:12, marginRight:4 }}>Resolution:</label>
          <select value={precision} onChange={e => setPrecision(parseInt(e.target.value,10))} style={{ fontSize:12 }}>
            {[5,6,7,8,9].map(p=> <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setIsDark(!isDark)} style={{ fontSize:12, padding:'2px 6px' }}>
            {isDark ? '☀️ Day' : '🌙 Night'}
          </button>
        </div>
        <div className="wardrive-legend">
          <div><span style={{ display:'inline-block', width:12, height:12, background:'#00ff00', marginRight:6 }}></span> ≥80% - Very Reliable</div>
          <div><span style={{ display:'inline-block', width:12, height:12, background:'#88ff00', marginRight:6 }}></span> 50-80% - Usually Works</div>
          <div><span style={{ display:'inline-block', width:12, height:12, background:'#ffff00', marginRight:6 }}></span> 30-50% - Spotty</div>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} id="wardrive-map-root" />
    </div>
  );
}
