"use client";
import { useLocalStorage } from './useLocalStorage';

type NodeType = "meshcore" | "meshtastic";
export type PacketTypeFilter = '2' | '4' | '5' | '8' | '9' | 'other';

export interface MapLayerSettings {
  showNodes: boolean;
  showNodeNames: boolean;
  enableClustering: boolean;
  tileLayer: string;
  showAllNeighbors: boolean;
  useColors: boolean;
  nodeTypes: NodeType[];
  showMeshcoreCoverageOverlay: boolean;
  minPacketCount: number;
  showLivePacketPropagation: boolean;
  livePacketTypes: PacketTypeFilter[];
  showWardriveOverlay: boolean;
  wardriveResolution: number;
}

const DEFAULT_MAP_LAYER_SETTINGS: MapLayerSettings = {
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
};

export function useMapLayerSettings() {
  return useLocalStorage<MapLayerSettings>("mapLayerSettings", DEFAULT_MAP_LAYER_SETTINGS);
}

export const TILE_LAYERS = [
  { key: "openstreetmap", label: "OpenStreetMap" },
  { key: "opentopomap", label: "OpenTopoMap" },
  { key: "esri", label: "Esri World Imagery" },
];

export const NODE_TYPE_OPTIONS = [
  { key: "meshcore", label: "Meshcore" },
  { key: "meshtastic", label: "Meshtastic" },
];

export const LIVE_PACKET_TYPE_OPTIONS: Array<{
  key: PacketTypeFilter;
  payloadType?: number;
  color: string;
  labelKey: string;
}> = [
  { key: '2', payloadType: 0x02, color: '#2dd4bf', labelKey: 'mapSettings.packetTypeText' },
  { key: '4', payloadType: 0x04, color: '#38bdf8', labelKey: 'mapSettings.packetTypeAdvert' },
  { key: '5', payloadType: 0x05, color: '#a3e635', labelKey: 'mapSettings.packetTypeGroupText' },
  { key: '8', payloadType: 0x08, color: '#c084fc', labelKey: 'mapSettings.packetTypePath' },
  { key: '9', payloadType: 0x09, color: '#fb7185', labelKey: 'mapSettings.packetTypeTrace' },
  { key: 'other', color: '#f59e0b', labelKey: 'mapSettings.packetTypeOther' },
];
