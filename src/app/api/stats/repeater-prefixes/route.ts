import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";
import { generateRegionWhereClause } from "@/lib/regionFilters";
import { getPathHashSizeBytes, getPubkeyPrefix } from "@/lib/pathUtils";

interface RepeaterPrefixRow {
  public_key: string;
  node_name: string;
  prefix: string;
  hash_size_bytes: number;
  last_seen: string;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const region = searchParams.get("region") || undefined;
    
    const regionFilter = generateRegionWhereClause(region);
    const regionWhereClause = regionFilter.whereClause ? `AND ${regionFilter.whereClause}` : '';
    
    const query = `
      SELECT
          public_key,
          argMax(node_name, ingest_timestamp) AS node_name,
          upper(hex(argMax(path, ingest_timestamp))) AS path,
          argMax(path_len, ingest_timestamp) AS path_len,
          max(ingest_timestamp) AS last_seen
      FROM meshcore_adverts
      WHERE is_repeater = 1
          ${regionWhereClause}
      GROUP BY public_key
      HAVING last_seen >= now() - INTERVAL 2 DAY
      ORDER BY last_seen DESC, public_key ASC
    `;
    const resultSet = await clickhouse.query({ query, format: 'JSONEachRow' });
    const repeaters = await resultSet.json() as Array<{
      public_key: string;
      node_name: string;
      path: string;
      path_len: number;
      last_seen: string;
    }>;

    const rows: RepeaterPrefixRow[] = repeaters.map((repeater) => {
      const hashSizeBytes = getPathHashSizeBytes(repeater.path, repeater.path_len);
      return {
        public_key: repeater.public_key,
        node_name: repeater.node_name,
        prefix: getPubkeyPrefix(repeater.public_key, hashSizeBytes),
        hash_size_bytes: hashSizeBytes,
        last_seen: repeater.last_seen,
      };
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch repeater prefixes" }, { status: 500 });
  }
} 