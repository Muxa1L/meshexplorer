-- ClickHouse Database Schema for MeshExplorer
-- This schema defines the database structure for storing and analyzing Meshtastic mesh network data
-- 
-- Created: 2025-12-22
-- Database: meshexplorer (or your chosen database name)

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS meshexplorer;

-- Use the database
USE meshexplorer;

-- ============================================================================
-- MAIN TABLES
-- ============================================================================

-- Wardrive-specific tables for coverage and samples
CREATE TABLE IF NOT EXISTS wardrive_coverage (
    hash String,
    received Float64,
    lost Float64,
    samples UInt32,
    repeaters String, -- JSON object containing repeater details
    lastUpdate DateTime,
    appVersion String
) ENGINE = MergeTree()
ORDER BY hash
TTL toDateTime(lastUpdate) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS wardrive_samples (
    lat Float64,
    lon Float64,
    path String,
    snr Float64,
    rssi Float64,
    ingest_timestamp DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY ingest_timestamp
TTL ingest_timestamp + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS wardrive_seen (
    id String,
    seen_at DateTime DEFAULT now(),
    expiration UInt32 -- seconds
) ENGINE = MergeTree()
ORDER BY id
TTL seen_at + toIntervalSecond(expiration);

-- DDL for meshcore_status table
-- Stores node status information from MQTT /status subtopic

CREATE TABLE IF NOT EXISTS meshcore_status
(
    timestamp DateTime64(6, 'UTC') COMMENT 'Status timestamp from MQTT message in UTC',
    broker String COMMENT 'MQTT broker URL',
    topic LowCardinality(String) COMMENT 'MQTT topic name',
    origin String COMMENT 'Node origin identifier',
    origin_pubkey FixedString(32) COMMENT 'Node public key',
    status LowCardinality(String) COMMENT 'Node status (online/offline)',
    model String COMMENT 'Device model',
    firmware_version String COMMENT 'Firmware version',
    radio String COMMENT 'Radio configuration (frequency, bandwidth, SF, CR)',
    client_version String COMMENT 'Client software version',
    battery_mv Nullable(UInt32) COMMENT 'Battery voltage in millivolts',
    uptime_secs Nullable(UInt64) COMMENT 'Node uptime in seconds',
    errors Nullable(UInt32) COMMENT 'Number of errors',
    queue_len Nullable(UInt32) COMMENT 'Message queue length',
    noise_floor Nullable(Int16) COMMENT 'Radio noise floor in dBm',
    last_rssi Nullable(Int16) COMMENT 'Last RSSI in dBm',
    last_snr Nullable(Float32) COMMENT 'Last SNR in dB',
    tx_air_secs Nullable(UInt32) COMMENT 'Transmit air time in seconds',
    rx_air_secs Nullable(UInt32) COMMENT 'Receive air time in seconds'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (origin_pubkey, timestamp)
SETTINGS index_granularity = 8192;

-- Index for efficient queries by origin name
CREATE INDEX IF NOT EXISTS idx_origin ON meshcore_status (origin) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_status ON meshcore_status (status) TYPE set(0) GRANULARITY 1;
-- Table: meshcore_packets
-- Stores raw packet data from MQTT brokers
-- This is the most granular table containing all packet information
CREATE TABLE IF NOT EXISTS meshcore_packets (
    -- Timestamps
    ingest_timestamp DateTime64(3) DEFAULT now64(3) COMMENT 'When packet was ingested into database',
    mesh_timestamp DateTime64(3) COMMENT 'Timestamp from mesh network',
    
    -- MQTT Information
    broker LowCardinality(String) COMMENT 'MQTT broker (e.g., mqtt.meshtastic.org)',
    topic LowCardinality(String) COMMENT 'MQTT topic indicating region (e.g., msh/US/2/e/)',
    
    -- Packet Data
    packet String COMMENT 'Raw packet data (hex encoded)',
    payload String COMMENT 'Packet payload data (hex encoded)',
    
    -- Routing Information
    path_len UInt8 DEFAULT 0 COMMENT 'Length of routing path',
    path String DEFAULT '' COMMENT 'Routing path (hex encoded pubkey prefixes)',
    route_type UInt8 DEFAULT 0 COMMENT 'Routing type identifier',
    
    -- Payload Information
    payload_type UInt8 COMMENT 'Type of payload (TEXT_MESSAGE_APP, POSITION_APP, etc.)',
    payload_version UInt8 DEFAULT 1 COMMENT 'Payload version',
    header String DEFAULT '' COMMENT 'Packet header information',
    
    -- Origin Information
    origin_pubkey FixedString(32) COMMENT 'Public key of originating node (32 bytes)',

    message_hash String,

    origin String,
    
    -- Indexes
    INDEX idx_ingest_time ingest_timestamp TYPE minmax GRANULARITY 1,
    INDEX idx_mesh_time mesh_timestamp TYPE minmax GRANULARITY 1,
    INDEX idx_broker broker TYPE bloom_filter GRANULARITY 1,
    INDEX idx_topic topic TYPE bloom_filter GRANULARITY 1,
    INDEX idx_payload_type payload_type TYPE set(0) GRANULARITY 1,
    INDEX idx_origin_pubkey origin_pubkey TYPE bloom_filter GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ingest_timestamp)
ORDER BY (ingest_timestamp, broker, topic)
TTL ingest_timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Table: meshcore_adverts
-- Stores parsed advertisement data from nodes
-- Advertisements contain node information, location, capabilities, and routing data
CREATE TABLE IF NOT EXISTS meshcore_adverts (
    -- Timestamps
    ingest_timestamp DateTime64(3) DEFAULT now64(3) COMMENT 'When advert was ingested into database',
    mesh_timestamp DateTime64(3) COMMENT 'Timestamp from mesh network',
    adv_timestamp DateTime64(3) COMMENT 'Advertisement timestamp from node',
    
    -- Node Identity
    public_key String COMMENT 'Full public key of advertised node (hex encoded)',
    node_name String DEFAULT '' COMMENT 'Human-readable node name',
    
    -- Location Data
    latitude Nullable(Float64) COMMENT 'Node latitude (-90 to 90)',
    longitude Nullable(Float64) COMMENT 'Node longitude (-180 to 180)',
    altitude Nullable(Int32) COMMENT 'Node altitude in meters',
    
    -- Node Capabilities (Boolean flags stored as UInt8)
    has_location UInt8 DEFAULT 0 COMMENT '1 if node has location data, 0 otherwise',
    is_repeater UInt8 DEFAULT 0 COMMENT '1 if node is configured as repeater',
    is_chat_node UInt8 DEFAULT 0 COMMENT '1 if node participates in chat',
    is_room_server UInt8 DEFAULT 0 COMMENT '1 if node is a room server',
    has_name UInt8 DEFAULT 0 COMMENT '1 if node has a custom name',
    
    -- MQTT Information
    broker LowCardinality(String) COMMENT 'MQTT broker where advert was received',
    topic LowCardinality(String) COMMENT 'MQTT topic indicating region',
    
    -- Routing Information
    path String DEFAULT '' COMMENT 'Routing path to this node (hex encoded)',
    path_len UInt8 DEFAULT 0 COMMENT 'Number of hops in path',
    origin_pubkey FixedString(32) COMMENT 'Public key of node that heard this advert',
    origin String DEFAULT '' COMMENT 'Origin node identifier',
    
    -- Packet Metadata
    packet_hash String COMMENT 'Hash of packet for deduplication',
    
    -- Indexes
    INDEX idx_public_key public_key TYPE bloom_filter GRANULARITY 1,
    INDEX idx_node_name node_name TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_ingest_time ingest_timestamp TYPE minmax GRANULARITY 1,
    INDEX idx_location (latitude, longitude) TYPE minmax GRANULARITY 1,
    INDEX idx_is_repeater is_repeater TYPE set(0) GRANULARITY 1,
    INDEX idx_broker broker TYPE bloom_filter GRANULARITY 1,
    INDEX idx_topic topic TYPE bloom_filter GRANULARITY 1,
    INDEX idx_origin_pubkey origin_pubkey TYPE bloom_filter GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ingest_timestamp)
ORDER BY (public_key, ingest_timestamp)
TTL ingest_timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;



-- ============================================================================
-- MATERIALIZED VIEWS
-- ============================================================================

-- Materialized View: meshcore_adverts_latest
-- Maintains the latest state for each node
-- Optimized for quick lookups of current node status
CREATE MATERIALIZED VIEW IF NOT EXISTS meshcore_adverts_latest
REFRESH EVERY 1 MINUTE
ENGINE = MergeTree
ORDER BY public_key
POPULATE
AS SELECT
    public_key,
    argMax(node_name, ingest_timestamp) as node_name,
    argMax(latitude, ingest_timestamp) as latitude,
    argMax(longitude, ingest_timestamp) as longitude,
    argMax(altitude, ingest_timestamp) as altitude,
    argMax(has_location, ingest_timestamp) as has_location,
    argMax(is_repeater, ingest_timestamp) as is_repeater,
    argMax(is_chat_node, ingest_timestamp) as is_chat_node,
    argMax(is_room_server, ingest_timestamp) as is_room_server,
    argMax(has_name, ingest_timestamp) as has_name,
    argMax(broker, ingest_timestamp) as broker,
    argMax(topic, ingest_timestamp) as topic,
    min(ingest_timestamp) as first_seen,
    max(ingest_timestamp) as last_seen,
    count() as advert_count
FROM meshcore_adverts
GROUP BY public_key;

-- Materialized View: unified_latest_nodeinfo
-- Unified view of latest node information with standardized fields
-- Used by the map view and general node queries
CREATE MATERIALIZED VIEW IF NOT EXISTS unified_latest_nodeinfo
REFRESH EVERY 1 MINUTE
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY node_id
POPULATE
AS SELECT
    public_key as node_id,
    node_name as name,
    substring(node_name, 1, 4) as short_name,
    latitude,
    longitude,
    altitude,
    first_seen,
    last_seen,
    multiIf(
        is_repeater = 1, 'repeater',
        is_room_server = 1, 'room_server',
        is_chat_node = 1, 'chat_node',
        has_location = 1, 'mobile',
        'unknown'
    ) as type
FROM meshcore_adverts_latest;

-- ============================================================================
-- DICTIONARY VIEWS (Optional - for faster lookups)
-- ============================================================================

-- Dictionary: node_lookup_dict
-- Fast key-value lookup for node information
-- Useful for real-time queries and API endpoints
CREATE DICTIONARY IF NOT EXISTS node_lookup_dict
(
    node_id String,
    name String,
    short_name String,
    latitude Nullable(Float64),
    longitude Nullable(Float64),
    last_seen DateTime64(3),
    type String
)
PRIMARY KEY node_id
SOURCE(CLICKHOUSE(
    TABLE 'unified_latest_nodeinfo'
    DB 'meshexplorer'
))
LAYOUT(COMPLEX_KEY_HASHED())
LIFETIME(MIN 60 MAX 300);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

CREATE VIEW IF NOT EXISTS meshcore_public_channel_messages AS
SELECT
	message_hash as message_id,
	MIN (ingest_timestamp) as ingest_timestamp,
	MIN (mesh_timestamp) as mesh_timestamp,
	MIN(hex(payload)) as payload,
	substring(payload, 1, 2) as channel_hash,
	substring(payload, 3, 4) as mac,
	unhex(substring(payload, 7)) as encrypted_message,
	count(*) AS message_count,
	groupArray(tuple(origin, hex(origin_pubkey), hex(path), broker, topic)) as origin_path_info
FROM
	meshcore_packets
WHERE
	payload_type = 5
GROUP BY
	message_hash ;

-- View: node_neighbor_relationships
-- Extracts direct neighbor relationships from adverts
-- Useful for network topology analysis
CREATE VIEW IF NOT EXISTS node_neighbor_relationships AS
SELECT
    hex(origin_pubkey) as source_node,
    public_key as target_node,
    path_len,
    count() as connection_count,
    max(ingest_timestamp) as last_connection,
    min(ingest_timestamp) as first_connection
FROM meshcore_adverts
WHERE path_len = 0  -- Direct connections only
    AND hex(origin_pubkey) != public_key  -- Exclude self-connections
GROUP BY source_node, target_node, path_len;

-- View: recent_active_nodes
-- Shows nodes active in the last 24 hours
-- Useful for monitoring and quick stats
CREATE VIEW IF NOT EXISTS recent_active_nodes AS
SELECT
    public_key,
    node_name,
    latitude,
    longitude,
    is_repeater,
    is_chat_node,
    is_room_server,
    last_seen,
    broker,
    topic
FROM meshcore_adverts_latest
WHERE last_seen >= now() - INTERVAL 24 HOUR
ORDER BY last_seen DESC;

-- View: channel_activity_stats
-- Aggregate statistics for chat channels
-- Useful for monitoring popular channels
CREATE VIEW IF NOT EXISTS channel_activity_stats AS 
SELECT
    channel_hash,
    count() AS message_count,
    countDistinct(origin_path_info) AS unique_senders,
    min(ingest_timestamp) AS first_message,
    max(ingest_timestamp) AS last_message,
    countDistinct(origin_path_info) AS regions
FROM default.meshcore_public_channel_messages
GROUP BY channel_hash
ORDER BY message_count DESC;

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Additional indexes for common query patterns can be added here
-- Note: Many indexes are already defined in table definitions above

-- ============================================================================
-- COMMENTS AND METADATA
-- ============================================================================

-- Add table comments for documentation
ALTER TABLE meshcore_packets MODIFY COMMENT 'Raw packet data from MQTT brokers with routing and payload information';
ALTER TABLE meshcore_adverts MODIFY COMMENT 'Parsed node advertisements with location, capabilities, and routing data';

-- ============================================================================
-- SAMPLE QUERIES
-- ============================================================================

-- These are example queries demonstrating how to use the schema
-- Uncomment and run these for testing purposes

-- Get all nodes with location in a bounding box:
-- SELECT node_id, name, latitude, longitude, last_seen, type
-- FROM unified_latest_nodeinfo
-- WHERE latitude BETWEEN 47.0 AND 48.0
--   AND longitude BETWEEN -122.5 AND -121.5
--   AND latitude IS NOT NULL
--   AND longitude IS NOT NULL
-- ORDER BY last_seen DESC;

-- Get recent chat messages for a channel:
-- SELECT 
--     ingest_timestamp,
--     mesh_timestamp,
--     channel_hash,
--     hex(encrypted_message) as message_hex,
--     message_count,
--     origin_path_info
-- FROM meshcore_public_channel_messages
-- WHERE channel_hash = 'your_channel_hash'
-- ORDER BY ingest_timestamp DESC
-- LIMIT 50;

-- Get node information with neighbors:
-- SELECT 
--     public_key,
--     node_name,
--     latitude,
--     longitude,
--     is_repeater,
--     last_seen
-- FROM meshcore_adverts_latest
-- WHERE public_key = 'your_public_key';

-- Count nodes by region (based on MQTT topic):
-- SELECT 
--     topic,
--     count(DISTINCT public_key) as unique_nodes,
--     count(*) as total_adverts
-- FROM meshcore_adverts
-- WHERE ingest_timestamp >= now() - INTERVAL 7 DAY
-- GROUP BY topic
-- ORDER BY unique_nodes DESC;

-- Get repeater statistics by prefix:
-- SELECT 
--     substring(public_key, 1, 2) as prefix,
--     count() as node_count,
--     groupArray(node_name) as node_names
-- FROM meshcore_adverts_latest
-- WHERE is_repeater = 1
--   AND last_seen >= now() - INTERVAL 2 DAY
-- GROUP BY prefix
-- ORDER BY node_count DESC;

-- ============================================================================
-- MAINTENANCE QUERIES
-- ============================================================================

-- Check table sizes:
-- SELECT 
--     table,
--     formatReadableSize(sum(bytes)) as size,
--     sum(rows) as rows,
--     max(modification_time) as latest_modification
-- FROM system.parts
-- WHERE database = 'meshexplorer'
--   AND active
-- GROUP BY table
-- ORDER BY sum(bytes) DESC;

-- Optimize tables (run periodically for better performance):
-- OPTIMIZE TABLE meshcore_packets FINAL;
-- OPTIMIZE TABLE meshcore_adverts FINAL;
-- OPTIMIZE TABLE meshcore_public_channel_messages FINAL;

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. TTL (Time To Live):
--    All main tables have a 90-day TTL to automatically remove old data.
--    Adjust this based on your storage capacity and retention requirements.

-- 2. Partitioning:
--    Tables are partitioned by month (YYYYMM) for efficient data management.
--    Old partitions are automatically dropped when TTL expires.

-- 3. Data Types:
--    - DateTime64(3) provides millisecond precision
--    - LowCardinality optimizes storage for repetitive string values
--    - FixedString(32) is used for 32-byte public keys
--    - Nullable is used sparingly as it has performance overhead

-- 4. Indexes:
--    - Bloom filters for exact match queries
--    - Minmax for range queries
--    - Token bloom filters for text search

-- 5. Materialized Views:
--    - Automatically updated when base tables receive new data
--    - Use ReplacingMergeTree to keep only latest version
--    - POPULATE clause fills view with existing data on creation

-- 6. Performance Tips:
--    - Always filter by time range when possible
--    - Use the ORDER BY columns in WHERE clauses
--    - Leverage materialized views for frequently accessed aggregates
--    - Run OPTIMIZE TABLE periodically on production systems

-- 7. Scaling Considerations:
--    - For high-volume deployments, consider distributed tables
--    - Use ReplicatedMergeTree for high availability
--    - Monitor system.query_log for slow queries
--    - Adjust index_granularity based on query patterns

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
