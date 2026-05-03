"use server";
import { clickhouse } from "./clickhouse";
import { generateRegionWhereClauseFromArray, generateRegionWhereClause, detectRegionFromBrokerTopic, detectRegion } from "@/lib/regionFilters";
import { getRegionConfig } from "@/lib/regions";
import { getPathHashSizeBytes, getPubkeyPrefix, splitPathHex } from "@/lib/pathUtils";

export interface WardriveSample{
  lat: number  | null;
  lon: number  | null;
}

export interface WardriveSamplePing{
  lat: number  | null;
  lon: number  | null;
  path: string | null;
  snr: number  | null; 
  rssi: number  | null
}

export interface WardriveCoverageCell {
  hash: string;
  received: number;
  lost: number;
  samples: number;
  repeaters: Record<string, { name: string; rssi: number | null; snr: number | null; lastSeen: string }>;
  lastUpdate: string;
  appVersion: string;
}

/**
 * Search observer/companion nodes using only meshcore_status table.
 * Returns latest status for each unique origin_pubkey, with optional filters.
 * @param searchParams - query, region, lastSeen, limit, exact
 */
export async function searchMeshcoreObservers(searchParams: {
  query?: string;
  region?: string;
  lastSeen?: string | null;
  limit?: number;
  exact?: boolean;
} = {}) {
  try {
    const {
      query: searchString,
      region,
      lastSeen,
      limit = 50,
      exact = false,
    } = searchParams;

    const where: string[] = [];
    const params: Record<string, any> = {};

    // Search by public key or origin (node name)
    if (searchString && searchString.trim()) {
      const trimmedQuery = searchString.trim();
      if (/^[0-9A-Fa-f]+$/.test(trimmedQuery)) {
        if (exact) {
          where.push(`origin_pubkey = {publicKeyExact:String}`);
          params.publicKeyExact = trimmedQuery.toUpperCase();
        } else {
          where.push(`origin_pubkey LIKE {publicKeyPattern:String}`);
          params.publicKeyPattern = `${trimmedQuery.toUpperCase()}%`;
        }
      } else {
        if (exact) {
          where.push(`lower(origin) = {originExact:String}`);
          params.originExact = trimmedQuery.toLowerCase();
        } else {
          where.push(`lower(origin) LIKE {originPattern:String}`);
          params.originPattern = `%${trimmedQuery.toLowerCase()}%`;
        }
      }
    }

    // lastSeen filter (in seconds)
    if (lastSeen !== null && lastSeen !== undefined && lastSeen !== "") {
      where.push(`timestamp >= now64() - INTERVAL {lastSeen:UInt32} SECOND`);
      params.lastSeen = Number(lastSeen);
    }

    // Region filter
    const regionFilter = generateRegionWhereClause(region);
    if (regionFilter.whereClause) {
      where.push(regionFilter.whereClause.replace(/broker/g, 'broker').replace(/topic/g, 'topic'));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // Get latest status for each unique origin_pubkey
    const query = `
      SELECT
        origin_pubkey as public_key,
        argMax(origin, timestamp) as node_name,
        NULL as latitude,
        NULL as longitude,
        0 as has_location,
        0 as is_repeater,
        0 as is_chat_node,
        0 as is_room_server,
        1 as has_name,
        min(timestamp) as first_heard,
        max(timestamp) as last_seen,
        argMax(broker, timestamp) as broker,
        argMax(topic, timestamp) as topic
      FROM meshcore_status
      ${whereClause}
      GROUP BY origin_pubkey
      ORDER BY last_seen DESC
      LIMIT {limit:UInt32}
    `;
    params.limit = limit;

    const resultSet = await clickhouse.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json();
    return rows as Array<{
      public_key: string;
      node_name: string;
      latitude: null;
      longitude: null;
      has_location: number;
      is_repeater: number;
      is_chat_node: number;
      is_room_server: number;
      has_name: number;
      first_heard: string;
      last_seen: string;
      broker: string;
      topic: string;
    }>;
  } catch (error) {
    console.error('ClickHouse error in searchMeshcoreObservers:', error);
    throw error;
  }
}

export async function putSample( sample: WardriveSample ){
// {"lat":45.07664680480957,"lon":39.04420852661133,"path":["d3"],"snr":14.5,"rssi":-29}
  await clickhouse.insert({
  table: 'wardrive_samples_web',
  // structure should match the desired format, JSONEachRow in this example
  values: [
    sample
  ],
  format: 'JSONEachRow',
  columns: [ 'lat', 'lon']
})
}

export async function putSamplePing( sample: WardriveSamplePing ){
// {"lat":45.07664680480957,"lon":39.04420852661133,"path":["d3"],"snr":14.5,"rssi":-29}
  await clickhouse.insert({
  table: 'wardrive_samples',
  // structure should match the desired format, JSONEachRow in this example
  values: [
    sample
  ],
  format: 'JSONEachRow',
  columns: [ 'lat', 'lon', 'path', 'snr', 'rssi']
})
}

/**
 * Retrieve all coverage cells stored in ClickHouse
 */
export async function getWardriveCoverage(precision: number = 10, days: number = 7): Promise<WardriveCoverageCell[]> {
  const timeWhere = days > 0 ? `WHERE ingest_timestamp >= now() - INTERVAL ${days} DAY` : '';
  // support aggregating at lower resolution by truncating geohash
  let query: string;
  query = `
    SELECT
      if (wsm.hash != '', wsm.hash ,wsw.hash) hash,
      mesh_received received,
      mesh_received + web_received samples,
      samples-received lost,
      repeaters,
      lastUpdate
    FROM
      (
      SELECT
        geohashEncode(lon, lat, ${precision}) hash,
        count(1) mesh_received,
        groupArray(distinct UPPER(repeater)) repeaters,
        max(ingest_timestamp)lastUpdate
      FROM
        wardrive_samples_mesh wsm
      ${timeWhere}
      GROUP BY
        hash) wsm
    FULL JOIN (
      SELECT
        geohashEncode(lon, lat, ${precision}) hash,
        count(1) web_received
      FROM
        wardrive_samples_web
      ${timeWhere}
      GROUP BY
        hash) wsw ON
      wsm.hash = wsw.hash
    ORDER BY
      lastUpdate DESC
  `;  
  try {
    const rs = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await rs.json();
    return rows as WardriveCoverageCell[];
  } catch (err) {
    console.error('Error querying wardrive_coverage', err);
    return [];
  }
}

export async function getWardriveCoveragePings(precision: number = 7): Promise<WardriveCoverageCell[]> {
  // support aggregating at lower resolution by truncating geohash
  let query: string;
  if (precision > 7) { 
    precision = 7; // enforce max precision of 7 for pings to avoid excessive cardinality
  }
  query = `
    SELECT
      substring(hash,1,${precision}) AS hash,
      sum(received) AS received,
      sum(lost) AS lost,
      sum(samples) AS samples,
      groupArray(repeaters) AS repeaters,
      max(lastUpdate) AS lastUpdate,
      any(appVersion) AS appVersion
    FROM wardrive_coverage
    GROUP BY hash
  `;
  try {
    const rs = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await rs.json();
    return rows as WardriveCoverageCell[];
  } catch (err) {
    console.error('Error querying wardrive_coverage', err);
    return [];
  }
}

/**
 * Upsert coverage cells into ClickHouse. Uses INSERT; collisions will overwrite
 * existing rows by hash using `ON CONFLICT` pattern or replacing value column
 * depending on table engine. For simplicity we perform a REPLACE query assuming
 * MergeTree with primary key hash.
 */
export async function upsertWardriveCoverage(cells: Record<string, WardriveCoverageCell>) {
  const values = Object.values(cells).map(c => ({
    hash: c.hash,
    received: c.received,
    lost: c.lost,
    samples: c.samples,
    repeaters: JSON.stringify(c.repeaters),
    lastUpdate: Math.floor(new Date(c.lastUpdate).getTime() / 1000),
    appVersion: c.appVersion
  }));
  if (values.length === 0) return;
  await clickhouse.insert({
    table: 'wardrive_coverage',
    values,
    format: 'JSONEachRow',
    columns: ['hash','received','lost','samples','repeaters','lastUpdate','appVersion']
  });
}

// ---------------------------------------------------
// wardrive_seen helpers
// ---------------------------------------------------
export async function hasSeenId(id: string): Promise<boolean> {
  const query = `
    SELECT count() AS cnt FROM wardrive_seen WHERE id = {id:String}
  `;
  const rs = await clickhouse.query({ query, query_params: { id }, format: 'JSONEachRow' });
  const rows = await rs.json() as Array<{ cnt: number }>;
  return rows.length > 0 && rows[0].cnt > 0;
}

export async function markSeenId(id: string, ttlSeconds: number = 60 * 60 * 24 * 90) {
  // insert with TTL if using MergeTree with TTL
  await clickhouse.insert({
    table: 'wardrive_seen',
    values: [{ id, seen_at: Math.floor(Date.now() / 1000), expiration: ttlSeconds }],
    format: 'JSONEachRow',
    columns: ['id','seen_at','expiration']
  });
}

export async function getNodePositions({ minLat, maxLat, minLng, maxLng, nodeTypes, lastSeen, region }: { minLat?: string | null, maxLat?: string | null, minLng?: string | null, maxLng?: string | null, nodeTypes?: string[], lastSeen?: string | null, region?: string | null
 } = {}) {
  try {
    let where = [
      "latitude IS NOT NULL",
      "longitude IS NOT NULL"
    ];
    const params: Record<string, any> = {};
    if (minLat !== null && minLat !== undefined && minLat !== "") {
      where.push(`latitude >= {minLat:Float64}`);
      params.minLat = Number(minLat);
    }
    if (maxLat !== null && maxLat !== undefined && maxLat !== "") {
      where.push(`latitude <= {maxLat:Float64}`);
      params.maxLat = Number(maxLat);
    }
    if (minLng !== null && minLng !== undefined && minLng !== "") {
      where.push(`longitude >= {minLng:Float64}`);
      params.minLng = Number(minLng);
    }
    if (maxLng !== null && maxLng !== undefined && maxLng !== "") {
      where.push(`longitude <= {maxLng:Float64}`);
      params.maxLng = Number(maxLng);
    }
    if (nodeTypes && nodeTypes.length > 0) {
      where.push(`type IN {nodeTypes:Array(String)}`);
      params.nodeTypes = nodeTypes;
    }
    if (lastSeen !== null && lastSeen !== undefined && lastSeen !== "") {
      where.push(`last_seen >= now() - INTERVAL {lastSeen:UInt32} SECOND`);
      params.lastSeen = Number(lastSeen);
    }
    if (region !== null){
      const regionFilter = getRegionConfig(region!);
      where.push(`broker = {broker:String} AND topic = {topic:String}`);
      params.broker = regionFilter?.broker;
      params.topic = regionFilter?.topics[0];
    }
    else {
      return null;
    }
    
    const query = `SELECT node_id, name, short_name, latitude, longitude, last_seen, first_seen, type, broker, topic FROM unified_latest_nodeinfo WHERE ${where.join(" AND ")}`;
    const resultSet = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' });
    const rows = await resultSet.json() as Array<{
      node_id: string;
      name?: string | null;
      short_name?: string | null;
      latitude: number;
      longitude: number;
      last_seen: string;
      first_seen?: string;
      type: string;
      broker?: string;
      topic?: string;
      display_prefix?: string;
    }>;

    if (rows.length === 0) {
      return rows;
    }

    const nodeIds = rows.map((row) => row.node_id);
    const advertPathsQuery = `
      SELECT
        public_key,
        upper(hex(argMax(path, ingest_timestamp))) AS latest_path,
        argMax(path_len, ingest_timestamp) AS latest_path_len,
        argMax(is_repeater, ingest_timestamp) AS is_repeater,
        argMax(is_chat_node, ingest_timestamp) AS is_chat_node,
        argMax(is_room_server, ingest_timestamp) AS is_room_server
      FROM meshcore_adverts
      WHERE public_key IN {nodeIds:Array(String)}
      GROUP BY public_key
    `;
    const advertPathsResult = await clickhouse.query({
      query: advertPathsQuery,
      query_params: { nodeIds },
      format: 'JSONEachRow'
    });
    const advertPaths = await advertPathsResult.json() as Array<{
      public_key: string;
      latest_path: string;
      latest_path_len: number;
      is_repeater: number;
      is_chat_node: number;
      is_room_server: number;
    }>;

    const nodeDetailsByNodeId = new Map<string, {
      displayPrefix: string;
      isRepeater: boolean;
      isChatNode: boolean;
      isRoomServer: boolean;
    }>();
    advertPaths.forEach((row) => {
      const hashSizeBytes = getPathHashSizeBytes(row.latest_path, row.latest_path_len);
      nodeDetailsByNodeId.set(row.public_key, {
        displayPrefix: getPubkeyPrefix(row.public_key, hashSizeBytes),
        isRepeater: row.is_repeater === 1,
        isChatNode: row.is_chat_node === 1,
        isRoomServer: row.is_room_server === 1,
      });
    });

    return rows.map((row) => ({
      ...row,
      display_prefix: nodeDetailsByNodeId.get(row.node_id)?.displayPrefix ?? row.node_id.substring(0, 2).toUpperCase(),
      is_repeater: nodeDetailsByNodeId.get(row.node_id)?.isRepeater ?? false,
      is_chat_node: nodeDetailsByNodeId.get(row.node_id)?.isChatNode ?? false,
      is_room_server: nodeDetailsByNodeId.get(row.node_id)?.isRoomServer ?? false,
    }));
  } catch (error) {
    console.error('ClickHouse error in getNodePositions:', error);
    throw error;
  }
} 

export async function getLatestChatMessages({ limit = 20, before, after, channelId, region }: { limit?: number, before?: string, after?: string, channelId?: string, region?: string } = {}) {
  try {
    let where = [];
    const params: Record<string, any> = { limit };
    
    if (before) {
      where.push('ingest_timestamp < {before:DateTime64}');
      params.before = before;
    }
    if (after) {
      where.push('ingest_timestamp > {after:DateTime64}');
      params.after = after;
    }
    if (channelId) {
      where.push('channel_hash = {channelId:String}');
      params.channelId = channelId;
    }
    
    // Add region filtering if specified
    const regionFilter = generateRegionWhereClauseFromArray(region);
    if (regionFilter.whereClause) {
      where.push(regionFilter.whereClause);
    }
    
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const query = `SELECT ingest_timestamp, mesh_timestamp, channel_hash, mac, hex(encrypted_message) AS encrypted_message, message_count, origin_path_info, message_id FROM meshcore_public_channel_messages ${whereClause} ORDER BY ingest_timestamp DESC LIMIT {limit:UInt32}`;
    const resultSet = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' });
    const rows = await resultSet.json();
    return rows as Array<{
      ingest_timestamp: string;
      mesh_timestamp: string;
      channel_hash: string;
      mac: string;
      encrypted_message: string;
      message_count: number;
      origin_path_info: Array<[string, string, string, number, string, string]>; // Array of [origin, origin_pubkey, path, path_len, broker, topic] tuples
      message_id: string;
    }>;
  } catch (error) {
    console.error('ClickHouse error in getLatestChatMessages:', error);
    throw error;
  }
}

/**
 * Determines the region based on broker and topic information
 * @param broker Broker string
 * @param topic Topic string
 * @returns The detected region name or null if no region matches
 */
// Region detection functions moved to regionFilters.ts

export async function getMeshcoreNodeInfo(publicKey: string, limit: number = 50) {
  try {
    // Get basic node info from the latest advert and first seen time
    const nodeInfoQuery = `
      SELECT 
        public_key,
        argMax(node_name, ingest_timestamp) as node_name,
        argMax(latitude, ingest_timestamp) as latitude,
        argMax(longitude, ingest_timestamp) as longitude,
        argMax(has_location, ingest_timestamp) as has_location,
        argMax(is_repeater, ingest_timestamp) as is_repeater,
        argMax(is_chat_node, ingest_timestamp) as is_chat_node,
        argMax(is_room_server, ingest_timestamp) as is_room_server,
        argMax(has_name, ingest_timestamp) as has_name,
        argMax(broker, ingest_timestamp) as broker,
        argMax(topic, ingest_timestamp) as topic,
        max(ingest_timestamp) as last_seen,
        min(ingest_timestamp) as first_seen
      FROM meshcore_adverts 
      WHERE public_key = {publicKey:String}
      GROUP BY public_key
      LIMIT 1
    `;
    
    const nodeInfoResult = await clickhouse.query({ 
      query: nodeInfoQuery, 
      query_params: { publicKey }, 
      format: 'JSONEachRow' 
    });
    const nodeInfo = await nodeInfoResult.json() as Array<{
      public_key: string;
      node_name: string;
      latitude: number | null;
      longitude: number | null;
      has_location: number;
      is_repeater: number;
      is_chat_node: number;
      is_room_server: number;
      has_name: number;
      broker: string | null;
      topic: string | null;
      last_seen: string;
      first_seen: string;
    }>;
    
    if (!nodeInfo || nodeInfo.length === 0) {
      return null;
    }
    
    // Get recent adverts grouped by adv_timestamp with origin_path_pubkey tuples
    const advertsQuery = `
      SELECT 
        argMax(adv_timestamp, ingest_timestamp) as adv_timestamp,
        groupArray((origin, path, origin_pubkey, path_len)) as origin_path_pubkey_tuples,
        count() as advert_count,
        min(ingest_timestamp) as earliest_timestamp,
        max(ingest_timestamp) as latest_timestamp,
        argMax(latitude, ingest_timestamp) as latitude,
        argMax(longitude, ingest_timestamp) as longitude,
        argMax(is_repeater, ingest_timestamp) as is_repeater,
        argMax(is_chat_node, ingest_timestamp) as is_chat_node,
        argMax(is_room_server, ingest_timestamp) as is_room_server,
        argMax(has_location, ingest_timestamp) as has_location,
        packet_hash
      FROM (
        SELECT 
          ingest_timestamp,
          mesh_timestamp,
          adv_timestamp,
          hex(path) as path,
          path_len,
          latitude,
          longitude,
          is_repeater,
          is_chat_node,
          is_room_server,
          has_location,
          hex(origin_pubkey) as origin_pubkey,
          origin,
          packet_hash
        FROM meshcore_adverts 
        WHERE public_key = {publicKey:String}
        ORDER BY ingest_timestamp DESC
      )
      GROUP BY packet_hash
      ORDER BY max(ingest_timestamp) DESC
      LIMIT {limit:UInt32}
    `;
    
    const advertsResult = await clickhouse.query({ 
      query: advertsQuery, 
      query_params: { publicKey, limit }, 
      format: 'JSONEachRow' 
    });
    const adverts = await advertsResult.json();
    
    // Get location history (unique locations over time) - last 30 days only
    const locationHistoryQuery = `
      SELECT 
        mesh_timestamp,
        latitude,
        longitude
      FROM (
        SELECT 
          mesh_timestamp,
          latitude,
          longitude,
          row_number() OVER (PARTITION BY round(latitude, 6), round(longitude, 6) ORDER BY mesh_timestamp DESC) as rn
        FROM meshcore_adverts 
        WHERE public_key = {publicKey:String}
          AND latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND mesh_timestamp >= now() - INTERVAL 30 DAY
      ) 
      WHERE rn = 1
      ORDER BY mesh_timestamp DESC 
      LIMIT 100
    `;
    
    const locationResult = await clickhouse.query({ 
      query: locationHistoryQuery, 
      query_params: { publicKey }, 
      format: 'JSONEachRow' 
    });
    const locationHistory = await locationResult.json();
    
    // Check MQTT uplink status and last packet time per topic
    const mqttQuery = `
      SELECT 
        topic,
        broker,
        max(ingest_timestamp) as last_packet_time,
        max(ingest_timestamp) >= now() - INTERVAL 7 DAY as is_recent
      FROM meshcore_packets 
      WHERE hex(origin_pubkey) = {publicKey:String}
      GROUP BY topic, broker
      ORDER BY last_packet_time DESC
    `;
    
    const mqttResult = await clickhouse.query({ 
      query: mqttQuery, 
      query_params: { publicKey }, 
      format: 'JSONEachRow' 
    });
    const mqttTopics = await mqttResult.json() as Array<{
      topic: string;
      broker: string;
      last_packet_time: string;
      is_recent: boolean;
    }>;
    
    // Calculate overall MQTT status
    const hasPackets = mqttTopics.length > 0;
    const isUplinked = mqttTopics.some(topic => topic.is_recent);
    
    // Detect region from MQTT topics and advert data
    const detectedRegion = detectRegion(mqttTopics, nodeInfo[0].broker, nodeInfo[0].topic);
    
    return {
      node: nodeInfo[0],
      recentAdverts: adverts,
      locationHistory: locationHistory,
      mqtt: {
        is_uplinked: isUplinked,
        has_packets: hasPackets,
        topics: mqttTopics
      },
      region: detectedRegion
    };
  } catch (error) {
    console.error('ClickHouse error in getMeshcoreNodeInfo:', error);
    throw error;
  }
}

export async function getAllNodeNeighbors(lastSeen: string | null = null, minLat?: string | null, maxLat?: string | null, minLng?: string | null, maxLng?: string | null, nodeTypes?: string[], region?: string) {
  try {
    // Build where conditions for visible nodes
    let visibleNodeWhereConditions = [
      "latitude IS NOT NULL",
      "longitude IS NOT NULL"
    ];
    const params: Record<string, any> = {};
    
    // Add location bounds for visible nodes
    if (minLat !== null && minLat !== undefined && minLat !== "") {
      visibleNodeWhereConditions.push("latitude >= {minLat:Float64}");
      params.minLat = Number(minLat);
    }
    if (maxLat !== null && maxLat !== undefined && maxLat !== "") {
      visibleNodeWhereConditions.push("latitude <= {maxLat:Float64}");
      params.maxLat = Number(maxLat);
    }
    if (minLng !== null && minLng !== undefined && minLng !== "") {
      visibleNodeWhereConditions.push("longitude >= {minLng:Float64}");
      params.minLng = Number(minLng);
    }
    if (maxLng !== null && maxLng !== undefined && maxLng !== "") {
      visibleNodeWhereConditions.push("longitude <= {maxLng:Float64}");
      params.maxLng = Number(maxLng);
    }
    if (nodeTypes && nodeTypes.length > 0) {
      visibleNodeWhereConditions.push("type IN {nodeTypes:Array(String)}");
      params.nodeTypes = nodeTypes;
    }
    if (lastSeen !== null && lastSeen !== undefined && lastSeen !== "") {
      visibleNodeWhereConditions.push("last_seen >= now() - INTERVAL {lastSeen:UInt32} SECOND");
      params.lastSeen = Number(lastSeen);
    }

    // Build where conditions for meshcore adverts
    let meshcoreWhereConditions = [];
    if (lastSeen !== null && lastSeen !== undefined && lastSeen !== "") {
      meshcoreWhereConditions.push("ingest_timestamp >= now() - INTERVAL {lastSeen:UInt32} SECOND");
    }

    const meshcoreWhere = meshcoreWhereConditions.length > 0 ? `AND ${meshcoreWhereConditions.join(" AND ")}` : '';

    // Build region filtering for meshcore_packets
    const regionFilter = generateRegionWhereClause(region);
    const packetsRegionWhere = regionFilter.whereClause ? `AND ${regionFilter.whereClause}` : '';

    const allNeighborsQuery = `
      WITH visible_nodes AS (
        -- Get only nodes visible on the current map view
        SELECT 
          node_id,
          name,
          short_name,
          latitude,
          longitude,
          last_seen,
          first_seen,
          type
        FROM unified_latest_nodeinfo 
        WHERE ${visibleNodeWhereConditions.join(" AND ")}
      ),
      visible_node_details AS (
        -- Get latest attributes for visible nodes from meshcore_adverts
        SELECT 
          public_key,
          argMax(node_name, ingest_timestamp) as node_name,
          argMax(latitude, ingest_timestamp) as latitude,
          argMax(longitude, ingest_timestamp) as longitude,
          argMax(has_location, ingest_timestamp) as has_location,
          argMax(is_repeater, ingest_timestamp) as is_repeater,
          argMax(is_chat_node, ingest_timestamp) as is_chat_node,
          argMax(is_room_server, ingest_timestamp) as is_room_server,
          argMax(has_name, ingest_timestamp) as has_name
        FROM meshcore_adverts 
        WHERE public_key IN (SELECT node_id FROM visible_nodes)
          ${meshcoreWhere}
        GROUP BY public_key
      ),
      repeater_candidates AS (
        -- Candidate repeaters visible on the map in the selected region.
        SELECT DISTINCT
          mal.public_key,
          mal.node_name
        FROM meshcore_adverts_latest mal
        WHERE mal.is_repeater = 1
          AND mal.last_seen >= now() - INTERVAL 2 DAY
          AND mal.public_key IN (SELECT node_id FROM visible_nodes)
          ${regionFilter.whereClause ? `AND ${regionFilter.whereClause}` : ''}
      ),
      direct_connections AS (
        -- Get all direct connections (path_len = 0) but only between visible nodes
        SELECT DISTINCT
          hex(origin_pubkey) as source_node,
          public_key as target_node,
          'direct' as connection_type,
          1 as packet_count  -- Direct connections don't have packet counts, use 1 as default
        FROM meshcore_adverts 
        WHERE path_len = 0
          AND hex(origin_pubkey) != public_key
          -- Only include connections where both nodes are visible
          AND hex(origin_pubkey) IN (SELECT node_id FROM visible_nodes)
          AND public_key IN (SELECT node_id FROM visible_nodes)
          ${meshcoreWhere}
      ),
      path_neighbors AS (
        -- Extract neighbors from routing paths with unique payload counts.
        -- Prefix width is derived from path byte length / hop count.
        SELECT
          source_prefix,
          target_prefix,
          'path' as connection_type,
          count() as packet_count
        FROM (
          SELECT DISTINCT
            payload,
            upper(hex(substring(path, ((i - 1) * hash_size_bytes) + 1, hash_size_bytes))) as source_prefix,
            upper(hex(substring(path, (i * hash_size_bytes) + 1, hash_size_bytes))) as target_prefix
          FROM (
            SELECT DISTINCT
              payload,
              path,
              path_len,
              intDiv(length(path), path_len) as hash_size_bytes
            FROM meshcore_packets
            WHERE path_len >= 2
              AND length(path) > 0
              AND ingest_timestamp >= now() - INTERVAL 1 DAY
              ${packetsRegionWhere}
          ) p
          ARRAY JOIN range(1, path_len) as i
          WHERE i < path_len
            AND hash_size_bytes BETWEEN 1 AND 3
            AND hash_size_bytes * path_len = length(path)
        ) path_pairs
        WHERE source_prefix != target_prefix
        GROUP BY source_prefix, target_prefix
      ),
      prefix_to_key_map AS (
        -- Map variable-width prefixes back to a unique repeater public key.
        SELECT
          prefix,
          any(public_key) as public_key,
          any(node_name) as node_name,
          count() as node_count
        FROM (
          SELECT source_prefix as prefix FROM path_neighbors
          UNION DISTINCT
          SELECT target_prefix as prefix FROM path_neighbors
        ) prefixes
        CROSS JOIN repeater_candidates rc
        WHERE startsWith(rc.public_key, prefixes.prefix)
        GROUP BY prefix
        HAVING node_count = 1
      ),
      path_connections AS (
        -- Convert prefix-based path neighbors to public key connections
        -- Include all path connections (no exclusion of direct connections)
        SELECT 
          source_map.public_key as source_node,
          target_map.public_key as target_node,
          'path' as connection_type,
          pn.packet_count
        FROM path_neighbors pn
        JOIN prefix_to_key_map source_map ON pn.source_prefix = source_map.prefix
        JOIN prefix_to_key_map target_map ON pn.target_prefix = target_map.prefix
      ),
      direct_connections_filtered AS (
        -- Get direct connections but exclude pairs that already have path connections
        SELECT 
          source_node,
          target_node,
          connection_type,
          packet_count
        FROM direct_connections
        WHERE (source_node, target_node) NOT IN (
          SELECT source_node, target_node FROM path_connections
        )
        AND (target_node, source_node) NOT IN (
          SELECT source_node, target_node FROM path_connections
        )
      ),
      neighbor_connections AS (
        -- Combine path connections and filtered direct connections (path connections take precedence)
        SELECT source_node, target_node, connection_type, packet_count FROM path_connections
        UNION ALL
        SELECT source_node, target_node, connection_type, packet_count FROM direct_connections_filtered
      )
      SELECT 
        connections.source_node,
        connections.target_node,
        connections.connection_type,
        connections.packet_count,
        source_details.node_name as source_name,
        source_details.latitude as source_latitude,
        source_details.longitude as source_longitude,
        source_details.has_location as source_has_location,
        target_details.node_name as target_name,
        target_details.latitude as target_latitude,
        target_details.longitude as target_longitude,
        target_details.has_location as target_has_location
      FROM neighbor_connections AS connections
      LEFT JOIN visible_node_details AS source_details ON connections.source_node = source_details.public_key
      LEFT JOIN visible_node_details AS target_details ON connections.target_node = target_details.public_key
      WHERE source_details.public_key IS NOT NULL 
        AND target_details.public_key IS NOT NULL
        AND source_details.has_location = 1 
        AND target_details.has_location = 1
        AND source_details.latitude IS NOT NULL 
        AND source_details.longitude IS NOT NULL
        AND target_details.latitude IS NOT NULL 
        AND target_details.longitude IS NOT NULL
      ORDER BY connections.connection_type, connections.source_node, connections.target_node
    `;
    
    const neighborsResult = await clickhouse.query({ 
      query: allNeighborsQuery, 
      query_params: params, 
      format: 'JSONEachRow' 
    });
    const neighbors = await neighborsResult.json();
    
    return neighbors as Array<{
      source_node: string;
      target_node: string;
      connection_type: string;
      packet_count: number;
      source_name: string;
      source_latitude: number;
      source_longitude: number;
      source_has_location: number;
      target_name: string;
      target_latitude: number;
      target_longitude: number;
      target_has_location: number;
    }>;
  } catch (error) {
    console.error('ClickHouse error in getAllNodeNeighbors:', error);
    throw error;
  }
}

export async function getMeshcoreNodeNeighbors(publicKey: string, lastSeen: string | null = null) {
  try {
    const params: Record<string, any> = {
      publicKey,
      prefix1Pattern: `%${getPubkeyPrefix(publicKey, 1)}%`,
      prefix2Pattern: `%${getPubkeyPrefix(publicKey, 2)}%`,
      prefix3Pattern: `%${getPubkeyPrefix(publicKey, 3)}%`,
    };

    const advertsWhereConditions = [
      `(
        public_key = {publicKey:String}
        OR upper(hex(path)) LIKE {prefix1Pattern:String}
        OR upper(hex(path)) LIKE {prefix2Pattern:String}
        OR upper(hex(path)) LIKE {prefix3Pattern:String}
      )`
    ];

    if (lastSeen !== null) {
      advertsWhereConditions.push("ingest_timestamp >= now() - INTERVAL {lastSeen:UInt32} SECOND");
      params.lastSeen = Number(lastSeen);
    }

    const advertHopsQuery = `
      SELECT
        public_key,
        upper(hex(path)) as path,
        path_len,
        hex(origin_pubkey) as origin_pubkey
      FROM meshcore_adverts
      WHERE ${advertsWhereConditions.join(" AND ")}
    `;

    const nodeDetailsQuery = `
      SELECT
        public_key,
        node_name,
        latitude,
        longitude,
        has_location,
        is_repeater,
        is_chat_node,
        is_room_server,
        has_name
      FROM meshcore_adverts_latest
    `;

    const [advertHopsResult, nodeDetailsResult] = await Promise.all([
      clickhouse.query({
        query: advertHopsQuery,
        query_params: params,
        format: 'JSONEachRow'
      }),
      clickhouse.query({
        query: nodeDetailsQuery,
        format: 'JSONEachRow'
      })
    ]);

    const advertHops = await advertHopsResult.json() as Array<{
      public_key: string;
      path: string;
      path_len: number;
      origin_pubkey: string;
    }>;
    const nodeDetails = await nodeDetailsResult.json() as Array<{
      public_key: string;
      node_name: string;
      latitude: number | null;
      longitude: number | null;
      has_location: number;
      is_repeater: number;
      is_chat_node: number;
      is_room_server: number;
      has_name: number;
    }>;

    const detailsByPublicKey = new Map(nodeDetails.map((node) => [node.public_key, node]));
    const prefixToPublicKeys = new Map<string, string[]>();

    nodeDetails.forEach((node) => {
      for (const hashSizeBytes of [1, 2, 3]) {
        const prefix = getPubkeyPrefix(node.public_key, hashSizeBytes);
        const mapKey = `${hashSizeBytes}:${prefix}`;
        const existing = prefixToPublicKeys.get(mapKey) ?? [];
        existing.push(node.public_key);
        prefixToPublicKeys.set(mapKey, existing);
      }
    });

    const neighborKeys = new Set<string>();

    advertHops.forEach((advert) => {
      const hashSizeBytes = getPathHashSizeBytes(advert.path, advert.path_len);
      const queryPrefix = getPubkeyPrefix(publicKey, hashSizeBytes);
      const sourcePrefix = getPubkeyPrefix(advert.public_key, hashSizeBytes);
      const pathSlices = splitPathHex(advert.path, advert.path_len);
      const observerPrefix = getPubkeyPrefix(advert.origin_pubkey, hashSizeBytes);
      const hopPrefixes = [sourcePrefix, ...pathSlices, observerPrefix];

      for (let index = 0; index < hopPrefixes.length - 1; index++) {
        if (hopPrefixes[index] !== queryPrefix) {
          continue;
        }

        const nextPrefix = hopPrefixes[index + 1];
        let neighborPublicKey: string | null = null;

        if (index + 1 === hopPrefixes.length - 1 && nextPrefix === observerPrefix) {
          neighborPublicKey = advert.origin_pubkey;
        } else {
          const candidates = prefixToPublicKeys.get(`${hashSizeBytes}:${nextPrefix}`) ?? [];
          if (candidates.length === 1) {
            neighborPublicKey = candidates[0];
          }
        }

        if (neighborPublicKey && neighborPublicKey !== publicKey) {
          neighborKeys.add(neighborPublicKey);
        }
      }
    });

    return Array.from(neighborKeys)
      .map((neighborPublicKey) => {
        const details = detailsByPublicKey.get(neighborPublicKey);
        if (!details) {
          return null;
        }

        return {
          public_key: neighborPublicKey,
          node_name: details.node_name,
          latitude: details.latitude,
          longitude: details.longitude,
          has_location: details.has_location,
          is_repeater: details.is_repeater,
          is_chat_node: details.is_chat_node,
          is_room_server: details.is_room_server,
          has_name: details.has_name,
          directions: ['outgoing'],
        };
      })
      .filter((neighbor): neighbor is {
        public_key: string;
        node_name: string;
        latitude: number | null;
        longitude: number | null;
        has_location: number;
        is_repeater: number;
        is_chat_node: number;
        is_room_server: number;
        has_name: number;
        directions: string[];
      } => neighbor !== null)
      .sort((left, right) => left.public_key.localeCompare(right.public_key));
  } catch (error) {
    console.error('ClickHouse error in getMeshcoreNodeNeighbors:', error);
    throw error;
  }
}

interface SearchQuery {
  query?: string;
  region?: string;
  lastSeen?: string | null;
  limit?: number;
  exact?: boolean;
  is_repeater?: boolean;
}

export async function searchMeshcoreNodes(searchParams: SearchQuery | SearchQuery[] = {}) {
  try {
    // Normalize input to array format
    const queries = Array.isArray(searchParams) ? searchParams : [searchParams];
    
    // If no queries or empty array, return empty results
    if (queries.length === 0) {
      return [];
    }
    
    // Build individual query parts
    const queryParts: string[] = [];
    const allParams: Record<string, any> = {};
    
    queries.forEach((searchQuery, index) => {
      const {
        query: searchString,
        region,
        lastSeen,
        limit = 50,
        exact = false,
        is_repeater
      } = searchQuery;
      
      const where: string[] = [];
      const queryParams: Record<string, any> = {};
      
      // Add search conditions
      if (searchString && searchString.trim()) {
        const trimmedQuery = searchString.trim();
        
        // Check if it looks like a public key (hex string)
        if (/^[0-9A-Fa-f]+$/.test(trimmedQuery)) {
          if (exact) {
            // Exact public key match
            where.push(`public_key = {publicKeyExact_${index}:String}`);
            queryParams[`publicKeyExact_${index}`] = trimmedQuery.toUpperCase();
          } else {
            // Search by public key prefix
            where.push(`public_key LIKE {publicKeyPattern_${index}:String}`);
            queryParams[`publicKeyPattern_${index}`] = `${trimmedQuery.toUpperCase()}%`;
          }
        } else {
          if (exact) {
            // Exact node name match (case insensitive)
            where.push(`lower(node_name) = {nameExact_${index}:String}`);
            queryParams[`nameExact_${index}`] = trimmedQuery.toLowerCase();
          } else {
            // Search by node name (case insensitive, anywhere in the name)
            where.push(`lower(node_name) LIKE {namePattern_${index}:String}`);
            queryParams[`namePattern_${index}`] = `%${trimmedQuery.toLowerCase()}%`;
          }
        }
      }
      
      // Add lastSeen filter if provided
      if (lastSeen !== null && lastSeen !== undefined && lastSeen !== "") {
        where.push(`last_seen >= now() - INTERVAL {lastSeen_${index}:UInt32} SECOND`);
        queryParams[`lastSeen_${index}`] = Number(lastSeen);
      }
      
      // Add region filtering if specified
      const regionFilter = generateRegionWhereClause(region);
      if (regionFilter.whereClause) {
        where.push(regionFilter.whereClause);
      }
      
      // Add is_repeater filter if specified
      if (is_repeater !== undefined) {
        where.push(`is_repeater = {isRepeater_${index}:UInt8}`);
        queryParams[`isRepeater_${index}`] = is_repeater ? 1 : 0;
      }
      
      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      
      const queryPart = `
        SELECT 
          public_key,
          node_name,
          latitude,
          longitude,
          has_location,
          is_repeater,
          is_chat_node,
          is_room_server,
          has_name,
          first_heard,
          last_seen,
          broker,
          topic,
          ${index} as query_index
        FROM (
          SELECT 
            public_key,
            argMax(node_name, ingest_timestamp) as node_name,
            argMax(latitude, ingest_timestamp) as latitude,
            argMax(longitude, ingest_timestamp) as longitude,
            argMax(has_location, ingest_timestamp) as has_location,
            argMax(is_repeater, ingest_timestamp) as is_repeater,
            argMax(is_chat_node, ingest_timestamp) as is_chat_node,
            argMax(is_room_server, ingest_timestamp) as is_room_server,
            argMax(has_name, ingest_timestamp) as has_name,
            min(ingest_timestamp) as first_heard,
            max(ingest_timestamp) as last_seen,
            argMax(broker, ingest_timestamp) as broker,
            argMax(topic, ingest_timestamp) as topic
          FROM meshcore_adverts 
          GROUP BY public_key
        ) 
        ${whereClause} 
        ORDER BY last_seen DESC 
        LIMIT {limit_${index}:UInt32}
      `;
      
      queryParts.push(queryPart);
      queryParams[`limit_${index}`] = limit;
      
      // Add query params to the global params object
      Object.assign(allParams, queryParams);
    });
    
    // Combine all queries with UNION ALL
    const finalQuery = queryParts.join(' UNION ALL ');
    
    const resultSet = await clickhouse.query({ 
      query: finalQuery, 
      query_params: allParams, 
      format: 'JSONEachRow' 
    });
    const rows = await resultSet.json();
    
    type SearchResult = {
      public_key: string;
      node_name: string;
      latitude: number | null;
      longitude: number | null;
      has_location: number;
      is_repeater: number;
      is_chat_node: number;
      is_room_server: number;
      has_name: number;
      first_heard: string;
      last_seen: string;
      broker: string;
      topic: string;
      query_index?: number;
    };
    
    // If single query, return results without query_index
    if (!Array.isArray(searchParams)) {
      return (rows as SearchResult[]).map(row => {
        const { query_index, ...result } = row;
        return result;
      });
    }
    
    // For batch queries, group results by query_index
    const groupedResults = (rows as SearchResult[]).reduce((acc, row) => {
      const index = row.query_index || 0;
      if (!acc[index]) {
        acc[index] = [];
      }
      const { query_index, ...result } = row;
      acc[index].push(result);
      return acc;
    }, {} as Record<number, SearchResult[]>);
    
    // Return results in the same order as input queries
    return queries.map((_, index) => groupedResults[index] || []);
  } catch (error) {
    console.error('ClickHouse error in searchMeshcoreNodes:', error);
    throw error;
  }
} 