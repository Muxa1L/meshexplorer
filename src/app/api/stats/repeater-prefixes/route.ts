import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";
import { generateRegionWhereClause } from "@/lib/regionFilters";
import { SUPPORTED_PATH_HASH_SIZES, getPubkeyPrefix } from "@/lib/pathUtils";

interface RepeaterPrefixRow {
  prefix: string;
  hash_size_bytes: number;
  node_count: number;
  node_names: string[];
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
          node_name
      FROM meshcore_adverts_latest
      WHERE is_repeater = 1
          AND last_seen >= now() - INTERVAL 2 DAY
          ${regionWhereClause}
      ORDER BY public_key ASC
    `;
    const resultSet = await clickhouse.query({ query, format: 'JSONEachRow' });
    const repeaters = await resultSet.json() as Array<{ public_key: string; node_name: string }>;

    const byHashSize = Object.fromEntries(
      SUPPORTED_PATH_HASH_SIZES.map((hashSizeBytes) => {
        const groups = new Map<string, { nodeCount: number; nodeNames: Set<string> }>();

        repeaters.forEach(({ public_key, node_name }) => {
          const prefix = getPubkeyPrefix(public_key, hashSizeBytes);
          const existing = groups.get(prefix) ?? { nodeCount: 0, nodeNames: new Set<string>() };
          existing.nodeCount += 1;
          if (node_name) {
            existing.nodeNames.add(node_name);
          }
          groups.set(prefix, existing);
        });

        const rows: RepeaterPrefixRow[] = Array.from(groups.entries())
          .map(([prefix, group]) => ({
            prefix,
            hash_size_bytes: hashSizeBytes,
            node_count: group.nodeCount,
            node_names: Array.from(group.nodeNames).sort((left, right) => left.localeCompare(right)),
          }))
          .sort((left, right) => right.node_count - left.node_count || left.prefix.localeCompare(right.prefix));

        return [String(hashSizeBytes), rows];
      })
    ) as Record<string, RepeaterPrefixRow[]>;

    return NextResponse.json({
      data: byHashSize["1"] ?? [],
      byHashSize,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch repeater prefixes" }, { status: 500 });
  }
} 