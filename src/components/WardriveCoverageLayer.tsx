"use client";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// Minimal geohash bounds decoder (same logic as WardriveMap)
const Geohash = {
  base32: "0123456789bcdefghjkmnpqrstuvwxyz",
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
  },
};

function ageInDays(timestamp: string | number) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getFreshnessOpacity(daysOld: number): number {
  if (daysOld <= 7) return 1.0;
  if (daysOld <= 30) return 0.8;
  return 0.6;
}

function getCoverageColor(received: number, lost: number): string {
  const total = received + lost;
  if (total === 0) return "#cccccc";
  const rate = received / total;
  if (rate >= 0.8) return "#00ff00";
  if (rate >= 0.5) return "#88ff00";
  if (rate >= 0.3) return "#ffff00";
  if (rate >= 0.1) return "#ffaa00";
  return "#ff0000";
}

interface WardriveCoverageLayerProps {
  /** geohash precision (5-9). Default: 7 */
  precision?: number;
  /** fill opacity multiplier (0-1). Default: 0.3 */
  fillOpacityFactor?: number;
  /** data endpoint. Default: /api/samples */
  dataUrl?: string;
}

export default function WardriveCoverageLayer({
  precision = 7,
  fillOpacityFactor = 0.3,
  dataUrl = "/api/samples",
}: WardriveCoverageLayerProps) {
  const map = useMap();
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Create layer group and add to map
    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    async function loadCoverage() {
      try {
        const res = await fetch(`${dataUrl}?precision=${precision}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!mountedRef.current) return;
        if (!data?.coverage) return;

        layerGroup.clearLayers();

        Object.entries(data.coverage).forEach(([hash, cellAny]) => {
          const cell = cellAny as any;
          const b = Geohash.bounds(hash);
          const bounds: [[number, number], [number, number]] = [
            [b.sw.lat, b.sw.lon],
            [b.ne.lat, b.ne.lon],
          ];

          const daysOld = ageInDays(cell.lastUpdate);
          const opacityFactor = getFreshnessOpacity(daysOld);
          const color = getCoverageColor(cell.received ?? 0, cell.lost ?? 0);
          const dashArray = daysOld > 30 ? "5,5" : undefined;

          const rect = L.rectangle(bounds, {
            color,
            fillColor: color,
            weight: 1,
            opacity: opacityFactor,
            fillOpacity: opacityFactor * fillOpacityFactor,
            dashArray,
          });

          const successRate =
            (cell.received ?? 0) + (cell.lost ?? 0) > 0
              ? (((cell.received ?? 0) / ((cell.received ?? 0) + (cell.lost ?? 0))) * 100).toFixed(1)
              : "0";

          const freshnessLabel =
            daysOld <= 7
              ? "🟢 Live Coverage"
              : daysOld <= 30
              ? `🟡 Recent (${daysOld}d ago)`
              : `⚪ Old (${daysOld}d ago)`;

          let repeatersHtml = 'None';
          if (cell.repeaters) {
            const repeaterList: string[] = [];
            cell.repeaters.forEach((rep: any) => {
              if (rep == '{}') return;
              let obj = JSON.parse(rep);
              if (typeof obj === 'object' && obj !== undefined && obj !== null) {
                obj = Object.values(obj)[0];
                const escapedName = (obj["name"] || 'Unknown').replace(/'/g, "\\'");
                const repeaterHtml = `<span class="repeater-link" onclick="console.log('repeater click')" title="Click for details">${escapedName}</span>`;
                if (!repeaterList.includes(repeaterHtml)){
                  repeaterList.push(repeaterHtml);
                }
                // repeaterList.push(repeaterHtml);
              }
            });
            
            if (repeaterList.length > 0) repeatersHtml = repeaterList.join(', ');
          }

          const popup = `
            <div class="popup-content">
              <div style="color:${color}; font-weight:bold; margin-bottom:8px;">${freshnessLabel}</div>
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

          layerGroup.addLayer(rect);
        });
      } catch (err) {
        console.error("[WardriveCoverageLayer] Failed to load coverage", err);
      }
    }

    loadCoverage();
    intervalRef.current = setInterval(loadCoverage, 30_000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (layerGroupRef.current && map.hasLayer(layerGroupRef.current)) {
        map.removeLayer(layerGroupRef.current);
      }
      layerGroupRef.current = null;
    };
  }, [map, precision, dataUrl, fillOpacityFactor]);

  return null;
}
