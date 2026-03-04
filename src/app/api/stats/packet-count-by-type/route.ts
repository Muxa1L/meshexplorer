import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";
import { generateRegionWhereClause } from "@/lib/regionFilters";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const region = searchParams.get("region") || undefined;
    const days = parseInt(searchParams.get("days") || "7", 10);

    if (days < 1 || days > 90) {
      return NextResponse.json({ error: "Days must be between 1 and 90" }, { status: 400 });
    }

    const regionFilter = generateRegionWhereClause(region);
    const regionWhereClause = regionFilter.whereClause ? `AND ${regionFilter.whereClause}` : '';

    // Map payload type numbers to names from MeshCore packet format
    const payloadTypeNames: { [key: number]: string } = {
      0x00: "REQ",
      0x01: "RESPONSE",
      0x02: "TXT_MSG",
      0x03: "ACK",
      0x04: "ADVERT",
      0x05: "GRP_TXT",
      0x06: "GRP_DATA",
      0x07: "ANON_REQ",
      0x08: "PATH",
      0x09: "TRACE",
      0x0A: "MULTIPART",
      0x0B: "CONTROL",
      0x0F: "RAW_CUSTOM",
    };

    const query = `
      WITH time_range AS (
        SELECT fromUnixTimestamp(arrayJoin(range(
          toUnixTimestamp(toStartOfFiveMinute(toDateTime(now() - INTERVAL ${days} DAY))),
          toUnixTimestamp(toDateTime(now())),
          3600
        ))) AS time
      ),
      all_payload_types AS (
        SELECT DISTINCT payload_type
        FROM meshcore_packets
        WHERE ingest_timestamp >= now() - INTERVAL ${days} DAY
          ${regionWhereClause}
      ),
      time_type_combinations AS (
        SELECT time, payload_type
        FROM time_range
        CROSS JOIN all_payload_types
      ),
      packet_counts AS (
        SELECT 
          toStartOfFiveMinute(ingest_timestamp) AS time,
          payload_type,
          count(*) AS count
        FROM meshcore_packets
        WHERE ingest_timestamp >= now() - INTERVAL ${days} DAY
          ${regionWhereClause}
        GROUP BY time, payload_type
      )
      SELECT 
        ttc.time,
        ttc.payload_type,
        coalesce(pc.count, 0) AS count
      FROM time_type_combinations AS ttc
      LEFT JOIN packet_counts AS pc ON ttc.time = pc.time AND ttc.payload_type = pc.payload_type
      ORDER BY ttc.time ASC, ttc.payload_type ASC
    `;

    const resultSet = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await resultSet.json() as Array<{
      time: string;
      payload_type: number;
      count: number;
    }>;

    // Transform the data to include payload type names
    const transformedRows = rows.map(row => ({
      time: row.time,
      payload_type: row.payload_type,
      payload_type_name: payloadTypeNames[row.payload_type] || `UNKNOWN (${row.payload_type})`,
      count: row.count,
    }));

    return NextResponse.json({ data: transformedRows });
  } catch (error) {
    console.error("Error fetching packet count by type:", error);
    return NextResponse.json({ error: "Failed to fetch packet count by type" }, { status: 500 });
  }
}
