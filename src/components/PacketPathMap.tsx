"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { ResolvedPacketPathNode } from "@/lib/pathUtils";

function PacketPathMapViewport({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }

    map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);

  return null;
}

export default function PacketPathMap({
  points,
  resolvedNodes,
}: {
  points: [number, number][];
  resolvedNodes: ResolvedPacketPathNode[];
}) {
  return (
    <div className="h-64 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700">
      <MapContainer
        center={points[0]}
        zoom={10}
        scrollWheelZoom={true}
        attributionControl={false}
        dragging={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='Tiles &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <PacketPathMapViewport points={points} />
        <Polyline positions={points} pathOptions={{ color: "#7c3aed", weight: 4, opacity: 0.9 }} />
        {resolvedNodes.map(({ prefix, node, kind }) => (
          <CircleMarker
            key={`${node.node_id}-${kind}-${prefix}`}
            center={[node.latitude, node.longitude]}
            radius={kind === "origin" ? 7 : 6}
            pathOptions={{
              color: kind === "origin" ? "#2563eb" : "#7c3aed",
              fillColor: kind === "origin" ? "#60a5fa" : "#a78bfa",
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Tooltip>
              {(node.short_name || node.name || prefix).trim()} ({prefix})
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}