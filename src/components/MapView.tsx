"use client";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMapEvents, Marker, Popup, MapContainerProps, useMap, Polyline } from "react-leaflet";
import { useRouter, useSearchParams } from "next/navigation";
import 'leaflet/dist/leaflet.css';
import L from "leaflet";
import 'leaflet.markercluster/dist/leaflet.markercluster.js';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { useConfig } from "./ConfigContext";
import RefreshButton from "@/components/RefreshButton";
import MapLayerSettingsComponent from "@/components/MapLayerSettings";
import { LIVE_PACKET_TYPE_OPTIONS, type MapLayerSettings, type PacketTypeFilter } from "@/hooks/useMapLayerSettings";
import { NodeMarker, ClusterMarker, PopupContent, NODE_LEGEND_ITEMS } from "./MapIcons";
import { renderToString } from "react-dom/server";
import { buildApiUrl } from "@/lib/api";
import { NodePosition } from "@/types/map";
import { useNeighbors, type Neighbor } from "@/hooks/useNeighbors";
import { type AllNeighborsConnection } from "@/hooks/useAllNeighbors";
import { useQueryParams } from "@/hooks/useQueryParams";
import WardriveCoverageLayer from "@/components/WardriveCoverageLayer";
import { useLocale } from "./LocaleProvider";
import { getPathHashSizeBytes, getPubkeyPrefix, splitPathHex } from "@/lib/pathUtils";

const DEFAULT = {
  lat: 45.02756,
  lng: 39.07356,
  zoom: 12,
};

const REGION_DEFAULTS: Record<string, typeof DEFAULT> = {
  krasnodar_pub: {
    lat: 45.02756,
    lng: 39.07356,
    zoom: 12,
  },
  stavropol: {
    lat: 45.0307,
    lng: 41.9768,
    zoom: 12,
  },
};

interface MapQuery {
  lat?: number;
  lng?: number;
  zoom?: number;
}

function getDefaultMapView(region?: string) {
  if (region && REGION_DEFAULTS[region]) {
    return REGION_DEFAULTS[region];
  }

  return DEFAULT;
}

interface LiveMeshPacket {
  ingest_timestamp: string;
  path_len: number;
  path: string;
  route_type: number;
  payload_type: number;
  origin_pubkey: string;
  message_hash?: string;
}

interface ActivePacketAnimation {
  id: string;
  startedAt: number;
  durationMs: number;
  points: [number, number][];
  segmentLengths: number[];
  totalLength: number;
  marker: L.CircleMarker;
  markerGlow: L.CircleMarker;
  trail: L.Polyline;
  trailGlow: L.Polyline;
}

const LIVE_PACKET_COLORS: Record<number, string> = {
  0x02: '#2dd4bf',
  0x04: '#38bdf8',
  0x05: '#a3e635',
  0x08: '#c084fc',
  0x09: '#fb7185',
};

function getLivePacketColor(payloadType: number) {
  return LIVE_PACKET_COLORS[payloadType] ?? '#f59e0b';
}

function isLivePacketTypeEnabled(payloadType: number, enabledTypes: Set<PacketTypeFilter>) {
  const normalizedType = String(payloadType) as PacketTypeFilter;
  if (enabledTypes.has(normalizedType)) {
    return true;
  }

  return !LIVE_PACKET_COLORS[payloadType] && enabledTypes.has('other');
}

function buildNodePrefixLookup(nodes: NodePosition[]) {
  const lookups = new Map<number, Map<string, NodePosition | null>>();

  for (const hashSizeBytes of [1, 2, 3]) {
    const lookup = new Map<string, NodePosition | null>();

    for (const node of nodes) {
      if (!Number.isFinite(node.latitude) || !Number.isFinite(node.longitude)) {
        continue;
      }

      const prefix = getPubkeyPrefix(node.node_id, hashSizeBytes);
      const existing = lookup.get(prefix);

      if (!existing) {
        lookup.set(prefix, node);
      } else if (existing.node_id !== node.node_id) {
        lookup.set(prefix, null);
      }
    }

    lookups.set(hashSizeBytes, lookup);
  }

  return lookups;
}

function buildPacketPropagationPath(
  packet: LiveMeshPacket,
  nodePrefixLookup: Map<number, Map<string, NodePosition | null>>,
) {
  if (!packet.path || packet.path_len < 1) {
    return null;
  }

  const hashSizeBytes = getPathHashSizeBytes(packet.path, packet.path_len);
  const prefixLookup = nodePrefixLookup.get(hashSizeBytes);

  if (!prefixLookup) {
    return null;
  }

  const prefixes = [
    getPubkeyPrefix(packet.origin_pubkey, hashSizeBytes),
    ...splitPathHex(packet.path, packet.path_len),
  ].filter(Boolean);

  const points: [number, number][] = [];
  let lastNodeId: string | null = null;

  for (const prefix of prefixes) {
    const node = prefixLookup.get(prefix);
    if (!node || node.node_id === lastNodeId) {
      continue;
    }

    points.push([node.latitude, node.longitude]);
    lastNodeId = node.node_id;
  }

  return points.length >= 2 ? points : null;
}

function getSegmentLengths(points: [number, number][]) {
  const lengths: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const [startLat, startLng] = points[index - 1];
    const [endLat, endLng] = points[index];
    lengths.push(Math.hypot(endLat - startLat, endLng - startLng));
  }

  return lengths;
}

function getPointAlongPath(animation: ActivePacketAnimation, progress: number): [number, number] {
  if (animation.points.length === 1 || animation.totalLength <= 0) {
    return animation.points[0];
  }

  const targetDistance = animation.totalLength * progress;
  let coveredDistance = 0;

  for (let index = 0; index < animation.segmentLengths.length; index += 1) {
    const segmentLength = animation.segmentLengths[index];
    const nextDistance = coveredDistance + segmentLength;

    if (targetDistance <= nextDistance || index === animation.segmentLengths.length - 1) {
      const localProgress = segmentLength === 0 ? 0 : (targetDistance - coveredDistance) / segmentLength;
      const [startLat, startLng] = animation.points[index];
      const [endLat, endLng] = animation.points[index + 1];

      return [
        startLat + ((endLat - startLat) * localProgress),
        startLng + ((endLng - startLng) * localProgress),
      ];
    }

    coveredDistance = nextDistance;
  }

  return animation.points[animation.points.length - 1];
}


type ClusteredMarkersProps = { 
  nodes: NodePosition[];
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
  isLoadingNeighbors?: boolean;
  target?: '_blank' | '_self' | '_parent' | '_top';
  showNodeNames?: boolean;
  enableClustering?: boolean;
};

// Individual marker component
const IndividualMarker = React.memo(function IndividualMarker({ 
  node, 
  showNodeNames, 
  selectedNodeId, 
  onNodeClick,
  isLoadingNeighbors = false,
  target = '_self'
}: { 
  node: NodePosition; 
  showNodeNames: boolean; 
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
  isLoadingNeighbors?: boolean;
  target?: '_blank' | '_self' | '_parent' | '_top';
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const onNodeClickRef = useRef(onNodeClick);

  // Keep the callback ref updated
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    if (!map) return;

    const isSelected = selectedNodeId === node.node_id;
    const icon = L.divIcon({
      className: 'custom-node-marker-container',
      iconSize: [12, 24],
      iconAnchor: [6, 6],
      html: renderToString(
        <NodeMarker 
          node={node} 
          showNodeNames={showNodeNames} 
          isSelected={isSelected}
          isLoadingNeighbors={isSelected && isLoadingNeighbors}
        />
      ),
    });

    const marker = L.marker([node.latitude, node.longitude], { icon });
    (marker as any).options.nodeData = node;
    marker.bindPopup(renderToString(<PopupContent node={node} target={target} />));
    
    // Add hover handler for meshcore nodes
    if (node.type === "meshcore") {
      marker.on('mouseover', () => {
        onNodeClickRef.current(node.node_id);
      });
    }
    
    marker.addTo(map);
    markerRef.current = marker;

    return () => {
      if (markerRef.current && map.hasLayer(markerRef.current)) {
        map.removeLayer(markerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally omitting selectedNodeId, showNodeNames, isLoadingNeighbors to prevent marker recreation
  }, [map, node.node_id, node.latitude, node.longitude, node.type, target]);

  // Update marker when visual properties change (but don't recreate marker)
  useEffect(() => {
    if (markerRef.current) {
      // Update icon and popup content only
      const isSelected = selectedNodeId === node.node_id;
      const icon = L.divIcon({
        className: 'custom-node-marker-container',
        iconSize: [12, 24],
        iconAnchor: [6, 6],
        html: renderToString(
          <NodeMarker 
            node={node} 
            showNodeNames={showNodeNames} 
            isSelected={isSelected}
            isLoadingNeighbors={isSelected && isLoadingNeighbors}
          />
        ),
      });
      markerRef.current.setIcon(icon);
      markerRef.current.getPopup()?.setContent(renderToString(<PopupContent node={node} target={target} />));
    }
  }, [node, showNodeNames, selectedNodeId, isLoadingNeighbors]);

  // Handle position updates separately to avoid recreating marker
  useEffect(() => {
    if (markerRef.current) {
      const currentPos = markerRef.current.getLatLng();
      if (currentPos.lat !== node.latitude || currentPos.lng !== node.longitude) {
        markerRef.current.setLatLng([node.latitude, node.longitude]);
      }
    }
  }, [node.latitude, node.longitude]);

  return null;
});

// Clustered markers component
const ClusteredMarkersGroup = React.memo(function ClusteredMarkersGroup({ 
  nodes, 
  showNodeNames, 
  selectedNodeId, 
  onNodeClick,
  isLoadingNeighbors = false,
  target = '_self'
}: { 
  nodes: NodePosition[]; 
  showNodeNames: boolean; 
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
  isLoadingNeighbors?: boolean;
  target?: '_blank' | '_self' | '_parent' | '_top';
}) {
  const map = useMap();
  const clusterGroupRef = useRef<any>(null);
  const onNodeClickRef = useRef(onNodeClick);

  // Keep the callback ref updated
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  // Create cluster group only when map or nodes array changes
  useEffect(() => {
    if (!map) return;

    const iconCreateFunction = (cluster: any) => {
      const children = cluster.getAllChildMarkers();
      return L.divIcon({
        html: renderToString(<ClusterMarker>{children}</ClusterMarker>),
        className: 'custom-cluster-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
    };

    const markers = (L as any).markerClusterGroup({
      iconCreateFunction,
      maxClusterRadius: 40,
    });

    nodes.forEach((node: NodePosition) => {
      const isSelected = selectedNodeId === node.node_id;
      const icon = L.divIcon({
        className: 'custom-node-marker-container',
        iconSize: [12, 24],
        iconAnchor: [6, 6],
        html: renderToString(
          <NodeMarker 
            node={node} 
            showNodeNames={showNodeNames} 
            isSelected={isSelected}
            isLoadingNeighbors={isSelected && isLoadingNeighbors}
          />
        ),
      });
      const marker = L.marker([node.latitude, node.longitude], { icon });
      (marker as any).options.nodeData = node;
      marker.bindPopup(renderToString(<PopupContent node={node} target={target} />));
      
      // Add hover handler for meshcore nodes
      if (node.type === "meshcore") {
        marker.on('mouseover', () => {
          onNodeClickRef.current(node.node_id);
        });
      }
      
      markers.addLayer(marker);
    });

    markers._isClusterLayer = true;
    map.addLayer(markers);
    clusterGroupRef.current = markers;

    return () => {
      if (clusterGroupRef.current && map.hasLayer(clusterGroupRef.current)) {
        map.removeLayer(clusterGroupRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally omitting selectedNodeId, showNodeNames, isLoadingNeighbors to prevent cluster recreation
  }, [map, nodes, target]);

  // Update marker appearances when visual properties change
  useEffect(() => {
    if (!clusterGroupRef.current) return;

    clusterGroupRef.current.eachLayer((marker: any) => {
      const nodeData = marker.options.nodeData;
      if (nodeData) {
        const isSelected = selectedNodeId === nodeData.node_id;
        const icon = L.divIcon({
          className: 'custom-node-marker-container',
          iconSize: [16, 32],
          iconAnchor: [8, 8],
          html: renderToString(
            <NodeMarker 
              node={nodeData} 
              showNodeNames={showNodeNames} 
              isSelected={isSelected}
              isLoadingNeighbors={isSelected && isLoadingNeighbors}
            />
          ),
        });
        marker.setIcon(icon);
        marker.getPopup()?.setContent(renderToString(<PopupContent node={nodeData} target={target} />));
      }
    });
  }, [showNodeNames, selectedNodeId, isLoadingNeighbors]);

  return null;
});

const ClusteredMarkers = React.memo(function ClusteredMarkers({ 
  nodes, 
  selectedNodeId, 
  onNodeClick, 
  isLoadingNeighbors = false, 
  target = '_self',
  showNodeNames = true,
  enableClustering = true
}: ClusteredMarkersProps) {

  if (!enableClustering) {
    // Render individual marker components
    return (
      <>
        {nodes.map((node) => (
          <IndividualMarker 
            key={node.node_id} 
            node={node} 
            showNodeNames={showNodeNames}
            selectedNodeId={selectedNodeId}
            onNodeClick={onNodeClick}
            isLoadingNeighbors={isLoadingNeighbors}
            target={target}
          />
        ))}
      </>
    );
  } else {
    // Render clustered markers
    return (
      <ClusteredMarkersGroup 
        nodes={nodes} 
        showNodeNames={showNodeNames}
        selectedNodeId={selectedNodeId}
        onNodeClick={onNodeClick}
        isLoadingNeighbors={isLoadingNeighbors}
        target={target}
      />
    );
  }
});

// Component to render neighbor lines with directional arrows
function NeighborLines({ 
  selectedNodeId, 
  neighbors, 
  nodes 
}: { 
  selectedNodeId: string | null; 
  neighbors: Neighbor[]; 
  nodes: NodePosition[];
}) {
  if (!selectedNodeId || neighbors.length === 0) return null;

  // Find the selected node's position
  const selectedNode = nodes.find(node => node.node_id === selectedNodeId);
  if (!selectedNode) return null;

  // Create lines to neighbors that have location data and are visible on the map
  const lines = neighbors
    .filter(neighbor => neighbor.has_location && neighbor.latitude && neighbor.longitude)
    .map(neighbor => {
      // Check if the neighbor is also visible on the map
      const neighborOnMap = nodes.find(node => node.node_id === neighbor.public_key);
      
      const hasIncoming = neighbor.directions?.includes('incoming') || false;
      const hasOutgoing = neighbor.directions?.includes('outgoing') || false;
      const isBidirectional = hasIncoming && hasOutgoing;
      
      return {
        neighbor,
        positions: [
          [selectedNode.latitude, selectedNode.longitude] as [number, number],
          [neighbor.latitude!, neighbor.longitude!] as [number, number]
        ],
        isNeighborVisible: !!neighborOnMap,
        hasIncoming,
        hasOutgoing,
        isBidirectional
      };
    });


  return (
    <>
      {lines.map(({ neighbor, positions, isNeighborVisible, isBidirectional }) => {
        const lineColor = isNeighborVisible ? (isBidirectional ? '#10b981' : '#3b82f6') : '#94a3b8';
        
        return (
          <Polyline
            key={`${selectedNodeId}-${neighbor.public_key}`}
            positions={positions}
            pathOptions={{
              color: lineColor,
              weight: isBidirectional ? 3 : 2,
              opacity: 0.8,
              dashArray: isNeighborVisible ? undefined : '5, 5'
            }}
          />
        );
      })}
    </>
  );
}

// Component to render all neighbor lines for all nodes
function AllNeighborLines({ 
  connections, 
  nodes,
  useColors = true,
  minPacketCount = 1
}: { 
  connections: AllNeighborsConnection[]; 
  nodes: NodePosition[];
  useColors?: boolean;
  minPacketCount?: number;
}) {
  if (connections.length === 0) return null;

  // Create a set of visible node IDs for quick lookup
  const visibleNodeIds = new Set(nodes.map(node => node.node_id));

  // Filter connections to only show lines between nodes that are visible on the map
  // and meet the minimum packet count threshold
  const visibleConnections = connections.filter(connection => 
    visibleNodeIds.has(connection.source_node) && 
    visibleNodeIds.has(connection.target_node) &&
    connection.packet_count >= minPacketCount
  );

  // Calculate logarithmic thresholds based on packet counts for path connections
  const pathConnections = visibleConnections.filter(conn => conn.connection_type === 'path');
  const packetCounts = pathConnections.map(conn => conn.packet_count).sort((a, b) => a - b);
  
  const getLogThresholds = (counts: number[]) => {
    if (counts.length === 0) return { min: 1, t1: 1, t2: 1, t3: 1, t4: 1, max: 1 };
    
    const min = Math.max(1, counts[0]); // Ensure minimum is at least 1 for log calculation
    const max = counts[counts.length - 1];
    
    if (min === max) {
      return { min, t1: min, t2: min, t3: min, t4: min, max };
    }
    
    // Use logarithmic scale to create thresholds
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const logRange = logMax - logMin;
    
    const t1 = Math.pow(10, logMin + logRange * 0.2);
    const t2 = Math.pow(10, logMin + logRange * 0.4);
    const t3 = Math.pow(10, logMin + logRange * 0.6);
    const t4 = Math.pow(10, logMin + logRange * 0.8);
    
    return { 
      min, 
      t1: Math.round(t1), 
      t2: Math.round(t2), 
      t3: Math.round(t3), 
      t4: Math.round(t4), 
      max 
    };
  };
  
  const thresholds = getLogThresholds(packetCounts);

  return (
    <>
      {visibleConnections.map((connection) => {
        const positions: [number, number][] = [
          [connection.source_latitude, connection.source_longitude],
          [connection.target_latitude, connection.target_longitude]
        ];
        
        // Different colors based on connection type and logarithmic packet count
        const getConnectionColor = (connectionType: string, packetCount: number) => {
          if (!useColors) {
            // If colors are disabled, use consistent colors based on connection type
            return connectionType === 'direct' ? '#8b5cf6' : '#6b7280'; // Purple for direct, gray for path
          }
          
          if (connectionType === 'direct') {
            return '#8b5cf6'; // Purple for direct connections
          }
          
          // For path connections, use logarithmic thresholds for color intensity
          if (packetCount >= thresholds.t4) return '#dc2626'; // Red for highest log range
          if (packetCount >= thresholds.t3) return '#ea580c'; // Dark orange 
          if (packetCount >= thresholds.t2) return '#f59e0b'; // Orange
          if (packetCount >= thresholds.t1) return '#eab308'; // Yellow
          if (packetCount > thresholds.min) return '#84cc16';  // Light green for above minimum
          return '#6b7280'; // Gray for minimum traffic
        };
        
        const lineColor = getConnectionColor(connection.connection_type, connection.packet_count);
        
        // Consistent line weight for all connections
        const lineWeight = connection.connection_type === 'direct' ? 2 : 1;
        
        return (
          <Polyline
            key={`${connection.source_node}-${connection.target_node}-${connection.connection_type}`}
            positions={positions}
            pathOptions={{
              color: lineColor,
              weight: lineWeight,
              opacity: 0.8,
            }}
          />
        );
      })}
    </>
  );
}

function LivePacketPropagation({
  nodes,
  region,
  enabled,
  enabledPacketTypes,
}: {
  nodes: NodePosition[];
  region?: string;
  enabled: boolean;
  enabledPacketTypes: PacketTypeFilter[];
}) {
  const map = useMap();
  const nodePrefixLookup = useMemo(() => buildNodePrefixLookup(nodes), [nodes]);
  const enabledPacketTypeSet = useMemo(() => new Set(enabledPacketTypes), [enabledPacketTypes]);
  const nodePrefixLookupRef = useRef(nodePrefixLookup);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const animationsRef = useRef<ActivePacketAnimation[]>([]);
  const seenPacketIdsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    nodePrefixLookupRef.current = nodePrefixLookup;
  }, [nodePrefixLookup]);

  useEffect(() => {
    const paneName = 'live-packet-propagation-pane';
    if (!map.getPane(paneName)) {
      map.createPane(paneName);
    }

    const pane = map.getPane(paneName);
    if (pane) {
      pane.style.zIndex = '690';
      pane.style.pointerEvents = 'none';
    }

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    return () => {
      animationsRef.current.forEach((animation) => {
        animation.marker.remove();
        animation.trail.remove();
      });
      animationsRef.current = [];
      layerGroup.remove();
      layerGroupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    let frameId = 0;

    const animate = (timestamp: number) => {
      animationsRef.current = animationsRef.current.filter((animation) => {
        const elapsed = timestamp - animation.startedAt;
        const progress = elapsed / animation.durationMs;

        if (progress >= 1) {
          animation.marker.remove();
          animation.markerGlow.remove();
          animation.trail.remove();
          animation.trailGlow.remove();
          return false;
        }

        const [lat, lng] = getPointAlongPath(animation, progress);
        const visibility = progress < 0.12
          ? progress / 0.12
          : progress > 0.88
            ? (1 - progress) / 0.12
            : 1;
        const emphasis = 0.45 + (visibility * 0.9);

        animation.marker.setLatLng([lat, lng]);
        animation.markerGlow.setLatLng([lat, lng]);
        animation.marker.setRadius(4 + (visibility * 2));
        animation.markerGlow.setRadius(8 + (visibility * 5));
        animation.marker.setStyle({
          opacity: 0.55 + (visibility * 0.45),
          fillOpacity: 0.65 + (visibility * 0.35),
        });
        animation.markerGlow.setStyle({
          opacity: 0.08 + (visibility * 0.18),
          fillOpacity: 0.12 + (visibility * 0.28),
        });
        animation.trail.setStyle({
          opacity: 0.2 + ((1 - progress) * 0.28),
          weight: 2.5 + emphasis,
        });
        animation.trailGlow.setStyle({
          opacity: 0.06 + ((1 - progress) * 0.14),
          weight: 7 + (emphasis * 2.5),
        });

        return true;
      });

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (!enabled || nodes.length === 0 || enabledPacketTypeSet.size === 0) {
      return;
    }

    const paneName = 'live-packet-propagation-pane';
    const regionParam = region ? `&region=${encodeURIComponent(region)}` : '';
    const streamUrl = buildApiUrl(
      `/api/meshcore/stream/packets?pollInterval=1000&maxRows=24${regionParam}`,
    );
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) {
        return;
      }

      try {
        const packet = JSON.parse(event.data) as LiveMeshPacket & { type?: string };
        if (packet.type === 'error') {
          return;
        }

        if (!isLivePacketTypeEnabled(packet.payload_type, enabledPacketTypeSet)) {
          return;
        }

        const packetId = packet.message_hash
          || `${packet.ingest_timestamp}|${packet.origin_pubkey}|${packet.path}|${packet.payload_type}|${packet.route_type}`;
        const now = Date.now();

        for (const [seenId, seenAt] of seenPacketIdsRef.current.entries()) {
          if (now - seenAt > 120000) {
            seenPacketIdsRef.current.delete(seenId);
          }
        }

        if (seenPacketIdsRef.current.has(packetId)) {
          return;
        }
        seenPacketIdsRef.current.set(packetId, now);

        const points = buildPacketPropagationPath(packet, nodePrefixLookupRef.current);
        if (!points) {
          return;
        }

        const segmentLengths = getSegmentLengths(points);
        const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
        if (totalLength <= 0) {
          return;
        }

        const color = getLivePacketColor(packet.payload_type);
        const trailGlow = L.polyline(points, {
          pane: paneName,
          color,
          weight: 7,
          opacity: 0.16,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(layerGroup);
        const trail = L.polyline(points, {
          pane: paneName,
          color,
          weight: 3,
          opacity: 0.42,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(layerGroup);
        const markerGlow = L.circleMarker(points[0], {
          pane: paneName,
          radius: 9,
          stroke: false,
          fillColor: color,
          fillOpacity: 0.22,
          opacity: 0.18,
          interactive: false,
        }).addTo(layerGroup);
        const marker = L.circleMarker(points[0], {
          pane: paneName,
          radius: 5,
          color: '#ffffff',
          weight: 1.5,
          fillColor: color,
          fillOpacity: 1,
          opacity: 1,
          interactive: false,
        }).addTo(layerGroup);

        animationsRef.current.push({
          id: packetId,
          startedAt: performance.now(),
          durationMs: Math.max(1400, 900 + (points.length * 450)),
          points,
          segmentLengths,
          totalLength,
          marker,
          markerGlow,
          trail,
          trailGlow,
        });

        if (animationsRef.current.length > 80) {
          const overflow = animationsRef.current.splice(0, animationsRef.current.length - 80);
          overflow.forEach((animation) => {
            animation.marker.remove();
            animation.markerGlow.remove();
            animation.trail.remove();
            animation.trailGlow.remove();
          });
        }
      } catch (error) {
        console.error('Failed to process live packet propagation event:', error);
      }
    };

    eventSource.onerror = () => {
      // Let EventSource reconnect automatically.
    };

    return () => {
      eventSource.close();
    };
  }, [enabled, enabledPacketTypeSet, nodes.length, region]);

  return null;
}

function MapViewSync({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();

  useEffect(() => {
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const [targetLat, targetLng] = center;

    if (
      Math.abs(currentCenter.lat - targetLat) > 0.00001 ||
      Math.abs(currentCenter.lng - targetLng) > 0.00001 ||
      currentZoom !== zoom
    ) {
      map.setView(center, zoom);
    }
  }, [map, center, zoom]);

  return null;
}

function MapLegendPanel({
  title,
  className,
  isOpen,
  onToggle,
  showLabel,
  hideLabel,
  children,
}: {
  title: string;
  className: string;
  isOpen: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  children: React.ReactNode;
}) {
  const ToggleIcon = isOpen ? ChevronUpIcon : ChevronDownIcon;

  return (
    <div
      className={`${className} z-[1000] rounded-lg border border-gray-200 bg-white/90 text-gray-900 shadow-lg backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-gray-100`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold"
      >
        <span>{title}</span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {isOpen ? hideLabel : showLabel}
          <ToggleIcon className="h-3.5 w-3.5" />
        </span>
      </button>
      {isOpen && <div className="border-t border-gray-200 px-3 pb-3 pt-2 dark:border-neutral-700">{children}</div>}
    </div>
  );
}

interface MapViewProps {
  target?: '_blank' | '_self' | '_parent' | '_top';
}

export default function MapView({ target = '_self' }: MapViewProps = {}) {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const [nodePositions, setNodePositions] = useState<NodePosition[]>([]);
  const [bounds, setBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResultCount, setLastResultCount] = useState<number>(0);
  const fetchController = useRef<AbortController | null>(null);
  const lastRequestedBounds = useRef<[[number, number], [number, number]] | null>(null);
  const configResult = useConfig();
  const config = configResult?.config;
  const defaultMapView = useMemo(
    () => getDefaultMapView(config?.selectedRegion),
    [config?.selectedRegion],
  );
  
  // Map layer settings state
  const [mapLayerSettings, setMapLayerSettings] = useState<MapLayerSettings>({
    showNodes: true,
    showNodeNames: true,
    enableClustering: true,
    tileLayer: "openstreetmap",
    showAllNeighbors: false,
    useColors: true,
    nodeTypes: ["meshcore"],
    showMeshcoreCoverageOverlay: false,
    minPacketCount: 1,
    showLivePacketPropagation: true,
    livePacketTypes: ['2', '4', '5', '8', '9', 'other'],
    showWardriveOverlay: false,
    wardriveResolution: 7,
  });
  
  // Use query params to persist map position
  const { query: mapQuery, updateQuery: updateMapQuery } = useQueryParams<MapQuery>({
    lat: defaultMapView.lat,
    lng: defaultMapView.lng,
    zoom: defaultMapView.zoom,
  });

  const hasExplicitMapPosition = searchParams.has("lat") || searchParams.has("lng") || searchParams.has("zoom");

  useEffect(() => {
    if (!hasExplicitMapPosition) {
      updateMapQuery({
        lat: defaultMapView.lat,
        lng: defaultMapView.lng,
        zoom: defaultMapView.zoom,
      });
    }
  }, [defaultMapView, hasExplicitMapPosition, updateMapQuery]);

  const mapCenter: [number, number] = [mapQuery.lat ?? defaultMapView.lat, mapQuery.lng ?? defaultMapView.lng];
  const mapZoom = mapQuery.zoom ?? defaultMapView.zoom;
  
  // Neighbor-related state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllNeighbors, setShowAllNeighbors] = useState<boolean>(false);
  const [allNeighborConnections, setAllNeighborConnections] = useState<AllNeighborsConnection[]>([]);
  const [allNeighborsLoading, setAllNeighborsLoading] = useState<boolean>(false);
  const [isNodeLegendOpen, setIsNodeLegendOpen] = useState(true);
  const [isPathTrafficLegendOpen, setIsPathTrafficLegendOpen] = useState(true);
  const [isLivePacketLegendOpen, setIsLivePacketLegendOpen] = useState(true);

  // Update showAllNeighbors when mapLayerSettings changes
  useEffect(() => {
    setShowAllNeighbors(mapLayerSettings.showAllNeighbors);
  }, [mapLayerSettings.showAllNeighbors]);

  const toggleLivePacketType = useCallback((packetType: PacketTypeFilter) => {
    setMapLayerSettings((currentSettings) => {
      const isEnabled = currentSettings.livePacketTypes.includes(packetType);
      const nextTypes = isEnabled
        ? currentSettings.livePacketTypes.filter((type) => type !== packetType)
        : [...currentSettings.livePacketTypes, packetType];

      return {
        ...currentSettings,
        livePacketTypes: nextTypes,
      };
    });
  }, []);
  
  // Use TanStack Query for neighbors data
  const { data: neighbors = [], isLoading: neighborsLoading } = useNeighbors({
    nodeId: selectedNodeId,
    lastSeen: config?.lastSeen,
    enabled: !!selectedNodeId
  });

  type TileLayerKey = 'openstreetmap' | 'opentopomap' | 'esri';
  const tileLayerOptions: Record<TileLayerKey, { url: string; attribution: string; maxZoom: number; subdomains?: string[] }> = {
    openstreetmap: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: 'Tiles &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 22,
    },
    opentopomap: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: 'Tiles &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 17,
    },
    esri: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; <a href="https://developers.arcgis.com/documentation/mapping-apis-and-services/deployment/basemap-attribution/">Esri</a>',
      maxZoom: 21,
    },
  };
  const selectedTileLayer = tileLayerOptions[(mapLayerSettings.tileLayer as TileLayerKey) || 'openstreetmap'];

  // Handle node hover
  const handleNodeClick = useCallback((nodeId: string | null) => {
    if (nodeId !== null && selectedNodeId !== nodeId) {
      // Mouse over new node - set new selection (TanStack Query will handle fetching)
      setSelectedNodeId(nodeId);
    }
    // Lines persist on mouseout and when hovering over same node
  }, [selectedNodeId]);

  const fetchNodes = useCallback((bounds?: [[number, number], [number, number]], includeNeighbors: boolean = false) => {
    if (fetchController.current) {
      fetchController.current.abort();
    }
    const controller = new AbortController();
    fetchController.current = controller;
    setLoading(true);
    if (includeNeighbors) {
      setAllNeighborsLoading(true);
    }
    
    let url = "/api/map";
    const params = [];
    if (bounds) {
      const [[minLat, minLng], [maxLat, maxLng]] = bounds;
      params.push(`minLat=${minLat}`);
      params.push(`maxLat=${maxLat}`);
      params.push(`minLng=${minLng}`);
      params.push(`maxLng=${maxLng}`);
    }
    if (mapLayerSettings.nodeTypes && mapLayerSettings.nodeTypes.length > 0) {
      for (const type of mapLayerSettings.nodeTypes) {
        params.push(`nodeTypes=${encodeURIComponent(type)}`);
      }
    }
    if (config?.lastSeen !== null && config?.lastSeen !== undefined) {
      params.push(`lastSeen=${config.lastSeen}`);
    }
    if (config?.selectedRegion) {
      params.push(`region=${encodeURIComponent(config.selectedRegion)}`);
    }
    if (includeNeighbors) {
      params.push('includeNeighbors=true');
    }
    if (params.length > 0) {
      url += `?${params.join("&")}`;
    }
    
    fetch(buildApiUrl(url), { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // Backward compatibility: just nodes array
          setNodePositions(data);
          setLastResultCount(data.length);
          if (includeNeighbors) {
            // If we expected neighbors but got just nodes, clear neighbors
            setAllNeighborConnections([]);
          }
        } else if (data && data.nodes && Array.isArray(data.nodes)) {
          // New format: object with nodes and neighbors
          setNodePositions(data.nodes);
          setLastResultCount(data.nodes.length);
          if (data.neighbors && Array.isArray(data.neighbors)) {
            setAllNeighborConnections(data.neighbors);
          } else {
            setAllNeighborConnections([]);
          }
        } else {
          setNodePositions([]);
          setAllNeighborConnections([]);
        }
        
        if (fetchController.current === controller) {
          setLoading(false);
          setAllNeighborsLoading(false);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setNodePositions([]);
          setAllNeighborConnections([]);
        }
        if (fetchController.current === controller) {
          setLoading(false);
          setAllNeighborsLoading(false);
        }
      });
  }, [mapLayerSettings.nodeTypes, config?.lastSeen, config?.selectedRegion]);

  function isBoundsInside(inner: [[number, number], [number, number]], outer: [[number, number], [number, number]]) {
    // inner: [[minLat, minLng], [maxLat, maxLng]]
    // outer: [[minLat, minLng], [maxLat, maxLng]]
    return (
      inner[0][0] >= outer[0][0] && // minLat
      inner[0][1] >= outer[0][1] && // minLng
      inner[1][0] <= outer[1][0] && // maxLat
      inner[1][1] <= outer[1][1]    // maxLng
    );
  }

  function MapEventCatcher() {
    useMapEvents({
      moveend: (e) => {
        const map = e.target;
        const center = map.getCenter();
        const zoom = map.getZoom();
        
        // Update URL with new map position
        updateMapQuery({
          lat: Math.round(center.lat * 100000) / 100000, // Round to 5 decimal places
          lng: Math.round(center.lng * 100000) / 100000,
          zoom: zoom
        });
        
        const b = map.getBounds();
        const buffer = 0.2; // 20% buffer
        const latDiff = b.getNorthEast().lat - b.getSouthWest().lat;
        const lngDiff = b.getNorthEast().lng - b.getSouthWest().lng;
        const newBounds: [[number, number], [number, number]] = [
          [
            b.getSouthWest().lat - latDiff * buffer,
            b.getSouthWest().lng - lngDiff * buffer,
          ],
          [
            b.getNorthEast().lat + latDiff * buffer,
            b.getNorthEast().lng + lngDiff * buffer,
          ],
        ];
        // Only always refetch if we have too many nodes depending on clustering setting.
        if (
          (lastResultCount > (mapLayerSettings.enableClustering ? 5000: 1000)) ||
          !lastRequestedBounds.current ||
          !isBoundsInside(newBounds, lastRequestedBounds.current)
        ) {
          setBounds(newBounds);
        }
      },
      zoomend: (e) => {
        const map = e.target;
        const center = map.getCenter();
        const zoom = map.getZoom();
        
        // Update URL with new map position
        updateMapQuery({
          lat: Math.round(center.lat * 100000) / 100000, // Round to 5 decimal places
          lng: Math.round(center.lng * 100000) / 100000,
          zoom: zoom
        });
        
        const b = map.getBounds();
        const buffer = 0.2; // 20% buffer
        const latDiff = b.getNorthEast().lat - b.getSouthWest().lat;
        const lngDiff = b.getNorthEast().lng - b.getSouthWest().lng;
        const newBounds: [[number, number], [number, number]] = [
          [
            b.getSouthWest().lat - latDiff * buffer,
            b.getSouthWest().lng - lngDiff * buffer,
          ],
          [
            b.getNorthEast().lat + latDiff * buffer,
            b.getNorthEast().lng + lngDiff * buffer,
          ],
        ];
        // Only always refetch if clustering is disabled and lastResultCount > 1000
        if (
          (!mapLayerSettings.enableClustering && lastResultCount > 1000) ||
          !lastRequestedBounds.current ||
          !isBoundsInside(newBounds, lastRequestedBounds.current)
        ) {
          setBounds(newBounds);
        }
      },
    });
    return null;
  }

  // Set initial bounds on first render using the map instance
  function InitialBoundsSetter() {
    const map = useMap();
    useEffect(() => {
      if (!bounds && map) {
        const b = map.getBounds();
        setBounds([
          [b.getSouthWest().lat, b.getSouthWest().lng],
          [b.getNorthEast().lat, b.getNorthEast().lng],
        ]);
        map.attributionControl.setPrefix('map.w0z.is')
      }
    }, [map]);
    return null;
  }

  useEffect(() => {
    fetchController.current?.abort(); // abort any in-flight request on effect cleanup
    if (bounds) {
      fetchNodes(bounds, showAllNeighbors);
      lastRequestedBounds.current = bounds;
    } else {
      // Don't fetch until bounds is set
      setNodePositions([]);
      setAllNeighborConnections([]);
      lastRequestedBounds.current = null;
    }
    return () => {
      fetchController.current?.abort();
    };
  }, [bounds, mapLayerSettings.nodeTypes, config?.lastSeen, config?.selectedRegion, fetchNodes, showAllNeighbors]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Button Column */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
        <RefreshButton
          onClick={() => bounds && fetchNodes(bounds, showAllNeighbors)}
          loading={loading || !bounds}
          title={t("mapSettings.refreshMapNodes")}
          ariaLabel={t("mapSettings.refreshMapNodes")}
        />
        <MapLayerSettingsComponent
          onSettingsChange={setMapLayerSettings}
        />
      </div>
        <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        style={{ width: "100%", height: "100%", zIndex: 1 }}
        className="bg-gray-200"
      >
        <InitialBoundsSetter />
        <MapViewSync center={mapCenter} zoom={mapZoom} />
        <MapEventCatcher />
        <TileLayer
          attribution={selectedTileLayer.attribution}
          url={selectedTileLayer.url}
          maxZoom={selectedTileLayer.maxZoom}
          opacity={showAllNeighbors ? 0.3 : 1 }
          {...(selectedTileLayer.subdomains ? { subdomains: selectedTileLayer.subdomains } : {})}
        />
        {mapLayerSettings.showMeshcoreCoverageOverlay && (
          <TileLayer
            url="https://tiles.w0z.is/tiles/{z}/{x}/{y}.png"
            attribution="Meshcore Coverage &copy; <a href='https://w0z.is/'>w0z.is</a>"
            minZoom={1}
            maxZoom={22}
            minNativeZoom={8}
            maxNativeZoom={8}
            zIndex={1000}
            opacity={0.7}
          />
        )}
        {mapLayerSettings.showWardriveOverlay && (
          <WardriveCoverageLayer
            precision={mapLayerSettings.wardriveResolution}
          />
        )}
        {mapLayerSettings.showNodes && (
          <ClusteredMarkers 
            nodes={nodePositions} 
            selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick}
            isLoadingNeighbors={neighborsLoading}
            target={target}
            showNodeNames={mapLayerSettings.showNodeNames}
            enableClustering={mapLayerSettings.enableClustering}
          />
        )}
        <LivePacketPropagation
          nodes={nodePositions}
          region={config?.selectedRegion}
          enabled={mapLayerSettings.showLivePacketPropagation}
          enabledPacketTypes={mapLayerSettings.livePacketTypes}
        />
        <NeighborLines 
          selectedNodeId={selectedNodeId}
          neighbors={neighbors}
          nodes={nodePositions}
        />
        {showAllNeighbors && (
          <AllNeighborLines 
            connections={allNeighborConnections}
            nodes={nodePositions}
            useColors={mapLayerSettings.useColors}
            minPacketCount={mapLayerSettings.minPacketCount}
          />
        )}
      </MapContainer>
      
      {(mapLayerSettings.showNodes || mapLayerSettings.showLivePacketPropagation || (showAllNeighbors && mapLayerSettings.useColors && allNeighborConnections.length > 0)) && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-[1000] flex max-w-[calc(100%-2rem)] flex-col-reverse items-end gap-3">
          {mapLayerSettings.showNodes && (
            <MapLegendPanel
              title={t("mapSettings.nodeLegend")}
              className="pointer-events-auto min-w-[190px] max-w-[min(24rem,calc(100vw-2rem))]"
              isOpen={isNodeLegendOpen}
              onToggle={() => setIsNodeLegendOpen((current) => !current)}
              showLabel={t("mapSettings.showLegend")}
              hideLabel={t("mapSettings.hideLegend")}
            >
              <div className="flex flex-col gap-1.5 text-xs font-mono text-gray-700 dark:text-gray-200">
                {NODE_LEGEND_ITEMS.map((item) => (
                  <div key={item.labelKey} className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{t(item.labelKey)}</span>
                  </div>
                ))}
              </div>
            </MapLegendPanel>
          )}

          {/* Traffic Legend */}
          {showAllNeighbors && mapLayerSettings.useColors && allNeighborConnections.length > 0 && (() => {
            // Calculate logarithmic thresholds for legend display
            const pathConnections = allNeighborConnections.filter(conn => conn.connection_type === 'path');
            const packetCounts = pathConnections.map(conn => conn.packet_count).sort((a, b) => a - b);
            const legendThresholds = packetCounts.length > 0 ? (() => {
              const min = Math.max(1, packetCounts[0]);
              const max = packetCounts[packetCounts.length - 1];

              if (min === max) {
                return { min, t1: min, t2: min, t3: min, t4: min, max };
              }

              const logMin = Math.log10(min);
              const logMax = Math.log10(max);
              const logRange = logMax - logMin;

              return {
                min,
                t1: Math.round(Math.pow(10, logMin + logRange * 0.2)),
                t2: Math.round(Math.pow(10, logMin + logRange * 0.4)),
                t3: Math.round(Math.pow(10, logMin + logRange * 0.6)),
                t4: Math.round(Math.pow(10, logMin + logRange * 0.8)),
                max
              };
            })() : null;

            return legendThresholds && (
              <MapLegendPanel
                title={t("mapSettings.pathTraffic")}
                className="pointer-events-auto w-full max-w-[min(24rem,calc(100vw-2rem))]"
                isOpen={isPathTrafficLegendOpen}
                onToggle={() => setIsPathTrafficLegendOpen((current) => !current)}
                showLabel={t("mapSettings.showLegend")}
                hideLabel={t("mapSettings.hideLegend")}
              >
                <div className="flex flex-col gap-1 text-xs font-mono text-gray-700 dark:text-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-red-600"></div>
                    <span>{t("mapSettings.high")}: {legendThresholds.t4}+ {t("mapSettings.packets")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-orange-600"></div>
                    <span>{t("mapSettings.medHigh")}: {legendThresholds.t3}-{legendThresholds.t4 - 1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-amber-500"></div>
                    <span>{t("mapSettings.medium")}: {legendThresholds.t2}-{legendThresholds.t3 - 1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-yellow-500"></div>
                    <span>{t("mapSettings.lowMed")}: {legendThresholds.t1}-{legendThresholds.t2 - 1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-lime-500"></div>
                    <span>{t("mapSettings.low")}: {legendThresholds.min + 1}-{legendThresholds.t1 - 1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-0.5 w-5 bg-gray-500"></div>
                    <span>{t("mapSettings.minimal")}: {legendThresholds.min}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 border-t border-gray-200 pt-1 dark:border-neutral-700">
                    <div className="h-0.5 w-5 bg-violet-500"></div>
                    <span>{t("mapSettings.mqttConnections")}</span>
                  </div>
                </div>
              </MapLegendPanel>
            );
          })()}

          {mapLayerSettings.showLivePacketPropagation && (
            <MapLegendPanel
              title={t("mapSettings.packetLegend")}
              className="pointer-events-auto min-w-[190px] max-w-[min(24rem,calc(100vw-2rem))]"
              isOpen={isLivePacketLegendOpen}
              onToggle={() => setIsLivePacketLegendOpen((current) => !current)}
              showLabel={t("mapSettings.showLegend")}
              hideLabel={t("mapSettings.hideLegend")}
            >
              <div className="flex flex-col gap-[5px] text-xs font-mono">
                {LIVE_PACKET_TYPE_OPTIONS.map((packetType) => {
                  const isEnabled = mapLayerSettings.livePacketTypes.includes(packetType.key);

                  return (
                    <button
                      key={packetType.key}
                      type="button"
                      onClick={() => toggleLivePacketType(packetType.key)}
                      title={t(packetType.labelKey)}
                      className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-gray-700 transition dark:text-gray-200 ${
                        isEnabled
                          ? "bg-slate-900/5 opacity-100 dark:bg-white/10"
                          : "bg-transparent opacity-65 hover:bg-slate-900/5 dark:hover:bg-white/5"
                      }`}
                    >
                      <div className="relative h-[10px] w-5">
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '50%',
                            height: '6px',
                            transform: 'translateY(-50%)',
                            borderRadius: '999px',
                            backgroundColor: packetType.color,
                            opacity: isEnabled ? 0.2 : 0.1,
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '50%',
                            height: '2px',
                            transform: 'translateY(-50%)',
                            borderRadius: '999px',
                            backgroundColor: packetType.color,
                            opacity: isEnabled ? 0.8 : 0.45,
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '50%',
                            width: '8px',
                            height: '8px',
                            transform: 'translateY(-50%)',
                            borderRadius: '999px',
                            backgroundColor: packetType.color,
                            boxShadow: isEnabled ? `0 0 8px ${packetType.color}` : 'none',
                          }}
                        />
                      </div>
                      <span>{t(packetType.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </MapLegendPanel>
          )}
        </div>
      )}
    </div>
  );
} 
