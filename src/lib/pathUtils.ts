import type { NodePosition } from "@/types/map";

export interface PathData {
  origin: string;
  pubkey: string;
  path: string;
  pathLen?: number;
}

export interface PathGroup {
  path: string;
  pathSlices: string[];
  indices: number[];
  count: number;
}

export interface TreeNode {
  name: string;
  children?: TreeNode[];
}

export interface PacketPathInput {
  path: string;
  pathLen?: number;
  originPubkey: string;
}

export interface ResolvedPacketPathNode {
  prefix: string;
  node: NodePosition;
  kind: "origin" | "repeater";
}

export const SUPPORTED_PATH_HASH_SIZES = [1, 2, 3] as const;

function normalizePathHex(pathHex: string): string {
  return (pathHex || "").trim().toUpperCase();
}

export function getPathHashSizeBytes(pathHex: string, pathLen?: number): number {
  const normalizedPath = normalizePathHex(pathHex);

  if (!normalizedPath || !pathLen || pathLen <= 0) {
    return 1;
  }

  const hexCharsPerHop = normalizedPath.length / pathLen;
  if (!Number.isInteger(hexCharsPerHop) || hexCharsPerHop <= 0 || hexCharsPerHop % 2 !== 0) {
    return 1;
  }

  const hashSizeBytes = hexCharsPerHop / 2;
  if (hashSizeBytes < 1 || hashSizeBytes > 3) {
    return 1;
  }

  return hashSizeBytes;
}

export function splitPathHex(pathHex: string, pathLen?: number): string[] {
  const normalizedPath = normalizePathHex(pathHex);
  if (!normalizedPath) {
    return [];
  }

  const hashSizeBytes = getPathHashSizeBytes(normalizedPath, pathLen);
  const sliceLength = hashSizeBytes * 2;
  const slices: string[] = [];

  for (let index = 0; index < normalizedPath.length; index += sliceLength) {
    const slice = normalizedPath.slice(index, index + sliceLength);
    if (slice.length === sliceLength) {
      slices.push(slice);
    }
  }

  return slices;
}

export function getPubkeyPrefix(pubkey: string, hashSizeBytes?: number): string {
  const safeHashSizeBytes = hashSizeBytes && hashSizeBytes > 0 ? hashSizeBytes : 1;
  return (pubkey || "").substring(0, safeHashSizeBytes * 2).toUpperCase();
}

export function getSupportedPubkeyPrefixes(pubkey: string): string[] {
  return SUPPORTED_PATH_HASH_SIZES.map((hashSizeBytes) => getPubkeyPrefix(pubkey, hashSizeBytes));
}

export function buildNodePrefixLookup(nodes: NodePosition[]) {
  const lookups = new Map<number, Map<string, NodePosition | null>>();

  for (const hashSizeBytes of SUPPORTED_PATH_HASH_SIZES) {
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

export function resolvePacketPropagationNodes(
  packet: PacketPathInput,
  nodePrefixLookup: Map<number, Map<string, NodePosition | null>>,
): ResolvedPacketPathNode[] {
  if (!packet.path || !packet.pathLen || packet.pathLen < 1) {
    return [];
  }

  const hashSizeBytes = getPathHashSizeBytes(packet.path, packet.pathLen);
  const prefixLookup = nodePrefixLookup.get(hashSizeBytes);

  if (!prefixLookup) {
    return [];
  }

  const prefixes = [
    { prefix: getPubkeyPrefix(packet.originPubkey, hashSizeBytes), kind: "origin" as const },
    ...splitPathHex(packet.path, packet.pathLen).map((prefix) => ({ prefix, kind: "repeater" as const })),
  ].filter((entry) => entry.prefix);

  const nodes: ResolvedPacketPathNode[] = [];
  let lastNodeId: string | null = null;

  for (const entry of prefixes) {
    const node = prefixLookup.get(entry.prefix);
    if (!node || node.node_id === lastNodeId) {
      continue;
    }

    nodes.push({ prefix: entry.prefix, node, kind: entry.kind });
    lastNodeId = node.node_id;
  }

  return nodes;
}

export function buildPacketPropagationPath(
  packet: PacketPathInput,
  nodePrefixLookup: Map<number, Map<string, NodePosition | null>>,
) {
  const resolvedNodes = resolvePacketPropagationNodes(packet, nodePrefixLookup);
  const points = resolvedNodes.map(({ node }) => [node.latitude, node.longitude] as [number, number]);
  return points.length >= 2 ? points : null;
}

/**
 * Groups paths by their structure similarity
 */
export function groupPathsByStructure(paths: PathData[]): PathGroup[] {
  const pathGroups: PathGroup[] = [];
  
  paths.forEach(({ pubkey, path, pathLen }, index) => {
    const pathSlices = splitPathHex(path, pathLen);
    const hashSizeBytes = getPathHashSizeBytes(path, pathLen);
    const pubkeyPrefix = getPubkeyPrefix(pubkey, hashSizeBytes);
    const fullPathSlices = [...pathSlices, pubkeyPrefix];
    
    // Find existing group with same path structure
    const existingGroup = pathGroups.find(group => 
      group.pathSlices.length === fullPathSlices.length &&
      group.pathSlices.every((slice, i) => slice === fullPathSlices[i])
    );
    
    if (existingGroup) {
      existingGroup.indices.push(index);
      existingGroup.count++;
    } else {
      pathGroups.push({
        path: path + pubkeyPrefix,
        pathSlices: fullPathSlices,
        indices: [index],
        count: 1
      });
    }
  });

  return pathGroups;
}

/**
 * Builds a tree structure from path groups for visualization
 */
export function buildTreeFromPathGroups(pathGroups: PathGroup[], initiatingNodeKey?: string): TreeNode {
  const rootSliceLength = pathGroups.find(group => group.pathSlices.length > 0)?.pathSlices[0]?.length ?? 2;
  const rootName = initiatingNodeKey ? initiatingNodeKey.substring(0, rootSliceLength).toUpperCase() : "??";
  const root: TreeNode = { name: rootName, children: [] };
  
  pathGroups.forEach(group => {
    let currentNode = root;
    
    group.pathSlices.forEach((slice) => {
      let child = currentNode.children?.find(c => c.name === slice);
      
      if (!child) {
        child = { name: slice, children: [] };
        if (!currentNode.children) currentNode.children = [];
        currentNode.children.push(child);
      }
      
      currentNode = child;
    });
  });
  
  return root;
}

/**
 * Extracts all unique prefixes from a tree structure
 */
export function extractUniquePrefixes(treeData: TreeNode | null): string[] {
  if (!treeData) return [];
  
  const prefixes = new Set<string>();
  
  const extractPrefixes = (node: TreeNode) => {
    prefixes.add(node.name);
    node.children?.forEach(extractPrefixes);
  };
  
  extractPrefixes(treeData);
  return Array.from(prefixes);
}
