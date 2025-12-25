# ClickHouse Database Structure for MeshExplorer

This document describes the ClickHouse database schema used by MeshExplorer to store and analyze Meshtastic mesh network data.

## Table of Contents

- [Overview](#overview)
- [Database Tables](#database-tables)
- [Materialized Views](#materialized-views)
- [Helper Views](#helper-views)
- [Setup Instructions](#setup-instructions)
- [Query Examples](#query-examples)
- [Performance Optimization](#performance-optimization)
- [Maintenance](#maintenance)

## Overview

The MeshExplorer database is designed to efficiently store and query large volumes of mesh network data from Meshtastic devices. The schema supports:

- Real-time packet ingestion from MQTT brokers
- Node advertisement tracking with location and capabilities
- Encrypted message storage with metadata
- Network topology analysis
- Time-series analytics
- Multi-region support

### Key Features

- **Time-partitioned storage** with automatic data expiration (90-day TTL)
- **Materialized views** for fast access to current node states
- **Optimized indexes** for common query patterns
- **Region filtering** via MQTT broker and topic metadata
- **Efficient storage** using compression and specialized data types

## Database Tables

### 1. meshcore_packets

**Purpose**: Stores raw packet data received from MQTT brokers.

**Schema**:
```sql
CREATE TABLE meshcore_packets (
    ingest_timestamp DateTime64(3),      -- When packet entered database
    mesh_timestamp DateTime64(3),        -- Timestamp from mesh network
    broker LowCardinality(String),       -- MQTT broker name
    topic LowCardinality(String),        -- MQTT topic (region identifier)
    packet String,                       -- Raw packet data (hex)
    payload String,                      -- Payload data (hex)
    path_len UInt8,                      -- Number of routing hops
    path String,                         -- Routing path (hex)
    route_type UInt8,                    -- Routing type
    payload_type UInt8,                  -- Payload type identifier
    payload_version UInt8,               -- Payload version
    header String,                       -- Packet header
    origin_pubkey FixedString(32),       -- Origin node public key
    ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ingest_timestamp)
ORDER BY (ingest_timestamp, broker, topic);
```

**Use Cases**:
- Detailed packet analysis
- Network routing studies
- Traffic pattern analysis
- Historical packet reconstruction

**Retention**: 90 days (configurable via TTL)

---

### 2. meshcore_adverts

**Purpose**: Stores parsed node advertisement data with location and capabilities.

**Schema**:
```sql
CREATE TABLE meshcore_adverts (
    ingest_timestamp DateTime64(3),      -- Ingestion time
    mesh_timestamp DateTime64(3),        -- Mesh network time
    adv_timestamp DateTime64(3),         -- Advertisement timestamp
    public_key String,                   -- Node public key (hex)
    node_name String,                    -- Human-readable name
    latitude Nullable(Float64),          -- GPS latitude
    longitude Nullable(Float64),         -- GPS longitude
    altitude Nullable(Int32),            -- Altitude in meters
    has_location UInt8,                  -- Location available flag
    is_repeater UInt8,                   -- Repeater node flag
    is_chat_node UInt8,                  -- Chat participant flag
    is_room_server UInt8,                -- Room server flag
    has_name UInt8,                      -- Custom name flag
    broker LowCardinality(String),       -- MQTT broker
    topic LowCardinality(String),        -- MQTT topic
    path String,                         -- Routing path
    path_len UInt8,                      -- Path length
    origin_pubkey FixedString(32),       -- Hearing node pubkey
    origin String,                       -- Origin identifier
    packet_hash String,                  -- Deduplication hash
    ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ingest_timestamp)
ORDER BY (public_key, ingest_timestamp);
```

**Use Cases**:
- Node tracking and discovery
- Location history
- Network topology mapping
- Node capability analysis

**Key Fields**:
- `public_key`: Unique node identifier
- `path_len = 0`: Direct connections (neighbors)
- `path_len > 0`: Multi-hop connections
- Boolean flags stored as UInt8 (0/1) for efficiency

**Retention**: 90 days

---

### 3. meshcore_public_channel_messages

**Purpose**: Stores encrypted messages from public mesh channels.

**Schema**:
```sql
CREATE TABLE meshcore_public_channel_messages (
    ingest_timestamp DateTime64(3),      -- Ingestion time
    mesh_timestamp DateTime64(3),        -- Mesh time
    channel_hash String,                 -- Channel identifier hash
    mac String,                          -- Message authentication code
    encrypted_message String,            -- Encrypted content (hex)
    message_count UInt32,                -- Sequence number
    message_id String,                   -- Unique message ID
    origin_path_info Array(Tuple(        -- Array of routing info
        origin String,
        origin_pubkey String,
        path String,
        broker String,
        topic String
    )),
    ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ingest_timestamp)
ORDER BY (channel_hash, ingest_timestamp);
```

**Use Cases**:
- Chat message streaming
- Channel activity monitoring
- Message deduplication
- Multi-path message tracking

**Privacy Note**: Messages remain encrypted; only metadata is accessible.

**Retention**: 90 days

---

## Materialized Views

Materialized views automatically maintain aggregated data for faster queries.

### meshcore_adverts_latest

**Purpose**: Current state of all known nodes (most recent advertisement data).

```sql
CREATE MATERIALIZED VIEW meshcore_adverts_latest
ENGINE = ReplacingMergeTree(ingest_timestamp)
ORDER BY public_key
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
```

**Benefits**:
- O(1) lookup for current node state
- No need to scan historical data
- Automatically updated on new adverts

---

### unified_latest_nodeinfo

**Purpose**: Standardized node information with type classification.

```sql
CREATE MATERIALIZED VIEW unified_latest_nodeinfo
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY node_id
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
```

**Used By**:
- Map rendering (`/api/map`)
- Node search
- Statistics endpoints

---

## Helper Views

### node_neighbor_relationships

Shows direct neighbor connections between nodes.

```sql
SELECT source_node, target_node, connection_count, last_connection
FROM node_neighbor_relationships
WHERE source_node = 'ABC123'
ORDER BY last_connection DESC;
```

### recent_active_nodes

Lists all nodes active in the last 24 hours.

```sql
SELECT * FROM recent_active_nodes
WHERE is_repeater = 1
LIMIT 100;
```

### channel_activity_stats

Aggregates statistics for chat channels.

```sql
SELECT channel_hash, message_count, unique_senders
FROM channel_activity_stats
ORDER BY message_count DESC
LIMIT 10;
```

---

## Setup Instructions

### 1. Prerequisites

- ClickHouse Server 22.8 or later
- Access to ClickHouse client or HTTP interface
- Appropriate permissions to create databases and tables

### 2. Create Database

```bash
# Using clickhouse-client
clickhouse-client --query "CREATE DATABASE IF NOT EXISTS meshexplorer"

# Or via HTTP
curl 'http://localhost:8123/' --data 'CREATE DATABASE IF NOT EXISTS meshexplorer'
```

### 3. Run Schema

```bash
# Execute the schema file
clickhouse-client --database meshexplorer < clickhouse-schema.sql

# Or via HTTP
curl 'http://localhost:8123/' --data-binary @clickhouse-schema.sql
```

### 4. Verify Installation

```sql
-- Check tables
SHOW TABLES FROM meshexplorer;

-- Check table structure
DESCRIBE TABLE meshexplorer.meshcore_adverts;

-- Verify materialized views
SELECT table, engine 
FROM system.tables 
WHERE database = 'meshexplorer' 
  AND engine LIKE '%Materialized%';
```

### 5. Configure Application

Update your `.env` file or environment variables:

```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password
```

---

## Query Examples

### Get Nodes in Bounding Box

```sql
SELECT 
    node_id, 
    name, 
    latitude, 
    longitude, 
    last_seen, 
    type
FROM unified_latest_nodeinfo
WHERE latitude BETWEEN 47.0 AND 48.0
  AND longitude BETWEEN -122.5 AND -121.5
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
ORDER BY last_seen DESC;
```

### Find Node by Name or Public Key

```sql
-- By name (case-insensitive)
SELECT * FROM meshcore_adverts_latest
WHERE lower(node_name) LIKE '%seattle%';

-- By public key prefix
SELECT * FROM meshcore_adverts_latest
WHERE public_key LIKE 'ABC%';
```

### Get Node Neighbors

```sql
-- Direct neighbors (both directions)
SELECT DISTINCT
    public_key as neighbor_key,
    node_name as neighbor_name,
    latitude,
    longitude,
    is_repeater,
    last_seen
FROM meshcore_adverts_latest
WHERE public_key IN (
    -- Outgoing: nodes this node hears
    SELECT public_key FROM meshcore_adverts
    WHERE hex(origin_pubkey) = 'YOUR_NODE_KEY' AND path_len = 0
    
    UNION
    
    -- Incoming: nodes that hear this node
    SELECT hex(origin_pubkey) FROM meshcore_adverts
    WHERE public_key = 'YOUR_NODE_KEY' AND path_len = 0
);
```

### Recent Chat Messages

```sql
SELECT 
    ingest_timestamp,
    mesh_timestamp,
    channel_hash,
    hex(encrypted_message) as message_hex,
    message_count,
    origin_path_info
FROM meshcore_public_channel_messages
WHERE channel_hash = 'LongFast'
ORDER BY ingest_timestamp DESC
LIMIT 50;
```

### Node Activity Over Time (7-day rolling window)

```sql
SELECT 
    toDate(ingest_timestamp) as day,
    count(DISTINCT public_key) as unique_nodes_7day
FROM meshcore_adverts
WHERE ingest_timestamp >= today() - 30
  AND ingest_timestamp <= (
      SELECT max(ingest_timestamp) 
      FROM meshcore_adverts
  )
GROUP BY day
ORDER BY day ASC;
```

### Repeater Prefix Statistics

```sql
SELECT 
    substring(public_key, 1, 2) as prefix,
    count() as node_count,
    groupArray(node_name) as node_names,
    max(last_seen) as most_recent
FROM meshcore_adverts_latest
WHERE is_repeater = 1
  AND last_seen >= now() - INTERVAL 2 DAY
GROUP BY prefix
HAVING node_count = 1  -- Only non-conflicting prefixes
ORDER BY node_count DESC, prefix ASC;
```

### Network Path Analysis

```sql
SELECT 
    path_len,
    count() as packet_count,
    count(DISTINCT hex(origin_pubkey)) as unique_sources
FROM meshcore_packets
WHERE ingest_timestamp >= now() - INTERVAL 1 DAY
GROUP BY path_len
ORDER BY path_len ASC;
```

---

## Performance Optimization

### Indexing Strategy

1. **Primary Keys**: Always filter by ORDER BY columns first
   - `meshcore_packets`: `(ingest_timestamp, broker, topic)`
   - `meshcore_adverts`: `(public_key, ingest_timestamp)`
   - `meshcore_public_channel_messages`: `(channel_hash, ingest_timestamp)`

2. **Secondary Indexes**: Use bloom filters for exact matches
   - Public keys, node names, channel hashes
   - MQTT brokers and topics

3. **Time-based Queries**: Always include time range
   ```sql
   WHERE ingest_timestamp >= now() - INTERVAL 7 DAY
   ```

### Query Best Practices

1. **Use Materialized Views** for current state queries
   ```sql
   -- Good: Fast lookup
   SELECT * FROM meshcore_adverts_latest WHERE public_key = 'ABC';
   
   -- Slow: Scans historical data
   SELECT * FROM meshcore_adverts WHERE public_key = 'ABC' ORDER BY ingest_timestamp DESC LIMIT 1;
   ```

2. **Limit Result Sets**
   ```sql
   SELECT * FROM meshcore_adverts
   WHERE ingest_timestamp >= now() - INTERVAL 1 HOUR
   LIMIT 1000;
   ```

3. **Use PREWHERE for Large Scans**
   ```sql
   SELECT * FROM meshcore_adverts
   PREWHERE public_key = 'ABC123'
   WHERE ingest_timestamp >= now() - INTERVAL 7 DAY;
   ```

4. **Aggregate Before Joining**
   ```sql
   -- Good: Aggregates first
   WITH recent_nodes AS (
       SELECT public_key, max(last_seen) as last_seen
       FROM meshcore_adverts_latest
       WHERE last_seen >= now() - INTERVAL 1 DAY
   )
   SELECT * FROM recent_nodes;
   ```

---

## Maintenance

### Regular Tasks

#### 1. Optimize Tables (Weekly)

```sql
-- Merge data parts for better compression
OPTIMIZE TABLE meshcore_packets FINAL;
OPTIMIZE TABLE meshcore_adverts FINAL;
OPTIMIZE TABLE meshcore_public_channel_messages FINAL;
```

#### 2. Check Table Sizes

```sql
SELECT 
    table,
    formatReadableSize(sum(bytes)) as size,
    sum(rows) as rows,
    max(modification_time) as latest_modification
FROM system.parts
WHERE database = 'meshexplorer'
  AND active
GROUP BY table
ORDER BY sum(bytes) DESC;
```

#### 3. Monitor Query Performance

```sql
-- Slow queries in the last hour
SELECT 
    query_duration_ms,
    query,
    read_rows,
    formatReadableSize(read_bytes) as data_read
FROM system.query_log
WHERE event_time >= now() - INTERVAL 1 HOUR
  AND type = 'QueryFinish'
  AND query NOT LIKE '%system.%'
ORDER BY query_duration_ms DESC
LIMIT 20;
```

#### 4. Check Materialized View Health

```sql
-- Verify views are up to date
SELECT 
    database,
    table,
    engine,
    total_rows,
    total_bytes
FROM system.tables
WHERE database = 'meshexplorer'
  AND engine LIKE '%Materialized%'
ORDER BY table;
```

### Troubleshooting

#### Slow Queries

1. Add time range filters
2. Use materialized views
3. Check index usage with `EXPLAIN`
4. Consider adding secondary indexes

#### High Disk Usage

1. Check TTL settings (default: 90 days)
2. Run OPTIMIZE TABLE to compress data
3. Verify old partitions are being dropped
4. Adjust partition retention if needed

#### Memory Issues

1. Limit result set sizes
2. Use streaming for large queries
3. Adjust `max_memory_usage` setting
4. Monitor with `system.metrics`

---

## Schema Evolution

### Adding New Columns

```sql
-- Add column to existing table
ALTER TABLE meshcore_adverts 
ADD COLUMN IF NOT EXISTS battery_level Nullable(UInt8)
AFTER altitude;

-- Rebuild materialized view if needed
DROP VIEW meshcore_adverts_latest;
CREATE MATERIALIZED VIEW meshcore_adverts_latest AS ...;
```

### Modifying TTL

```sql
-- Change data retention period
ALTER TABLE meshcore_packets 
MODIFY TTL ingest_timestamp + INTERVAL 180 DAY;
```

### Adding Indexes

```sql
-- Add new secondary index
ALTER TABLE meshcore_adverts
ADD INDEX idx_battery_level battery_level TYPE minmax GRANULARITY 1;
```

---

## Region Filtering

The schema supports multi-region deployments using MQTT broker and topic metadata:

### Region Examples

- **Seattle**: `mqtt.meshdev.wapnet.net` / `msh/US/SEA/#`
- **US (General)**: `mqtt.meshtastic.org` / `msh/US/2/e/#`
- **Europe**: `mqtt.meshtastic.org` / `msh/EU/2/e/#`
- **APAC**: `mqtt.meshtastic.org` / `msh/APAC/2/e/#`

### Querying by Region

```sql
-- Seattle nodes
SELECT * FROM meshcore_adverts_latest
WHERE broker = 'mqtt.meshdev.wapnet.net'
  AND topic LIKE 'msh/US/SEA/%';

-- US nodes (all topics)
SELECT * FROM meshcore_adverts_latest
WHERE topic LIKE 'msh/US/%';
```

---

## Backup and Restore

### Backup Database

```bash
# Backup schema
clickhouse-client --query "SHOW CREATE DATABASE meshexplorer" > backup-schema.sql

# Backup data
clickhouse-client --query "BACKUP DATABASE meshexplorer TO Disk('backups', 'meshexplorer-backup')"
```

### Restore Database

```bash
# Restore from backup
clickhouse-client --query "RESTORE DATABASE meshexplorer FROM Disk('backups', 'meshexplorer-backup')"
```

---

## Additional Resources

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [MergeTree Engine](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree/)
- [Materialized Views](https://clickhouse.com/docs/en/guides/developer/cascading-materialized-views/)
- [Query Optimization](https://clickhouse.com/docs/en/guides/improving-query-performance/)
- [Meshtastic Protocol](https://meshtastic.org/docs/developers/protobufs/)

---

## Support

For issues or questions:
- Check the application logs
- Review ClickHouse query logs
- Monitor system metrics
- Consult the troubleshooting section above

---

**Last Updated**: 2025-12-22
