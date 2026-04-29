import { NextResponse } from "next/server";
import { getWardriveCoverage } from "@/lib/clickhouse/actions";
import { clickhouse } from "@/lib/clickhouse/clickhouse";
import { getPubkeyPrefix, getSupportedPubkeyPrefixes } from "@/lib/pathUtils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const precision = Math.min(8, Math.max(1, parseInt(searchParams.get("precision") ?? "6", 10)));
  const days = Math.max(0, parseInt(searchParams.get("days") ?? "7", 10));
  try {
    const [coverageRows, repeatersRs] = await Promise.all([
      getWardriveCoverage(precision, days),
      clickhouse.query({
        query: `
          SELECT
            public_key,
            node_name                   AS name,
            latitude                    AS lat,
            longitude                   AS lon,
            last_seen
          FROM meshcore_adverts_latest
          WHERE is_repeater = 1
            AND latitude  IS NOT NULL
            AND longitude IS NOT NULL
            ${days > 0 ? `AND last_seen >= now() - INTERVAL ${days} DAY` : ""}
          ORDER BY last_seen DESC
        `,
        format: "JSONEachRow",
      }),
    ]);

    const rawRepeaters = (await repeatersRs.json()) as Array<{
      public_key: string;
      name: string;
      lat: number;
      lon: number;
      last_seen: string;
    }>;

    const repeaters = rawRepeaters.map((repeater) => ({
      id: getPubkeyPrefix(repeater.public_key, 3),
      legacyId: getPubkeyPrefix(repeater.public_key, 1),
      publicKey: repeater.public_key,
      prefixes: getSupportedPubkeyPrefixes(repeater.public_key),
      name: repeater.name,
      lat: repeater.lat,
      lon: repeater.lon,
      last_seen: repeater.last_seen,
    }));

    const coverage = coverageRows.map((r) => ({
      hash: r.hash,
      received: Number(r.received),
      lost: Number(r.lost),
      samples: Number(r.samples),
      repeaters:
        typeof r.repeaters === "string"
          ? JSON.parse(r.repeaters)
          : r.repeaters,
      lastUpdate: r.lastUpdate,
    }));

    return NextResponse.json(
      { coverage, repeaters },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (error) {
    console.error("Error in /api/coverage/get-nodes:", error);
    return NextResponse.json({ coverage: [], repeaters: [] }, { status: 500 });
  }
}
