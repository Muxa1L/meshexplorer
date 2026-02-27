import { NextResponse } from "next/server";
import { getWardriveCoverage } from "@/lib/clickhouse/actions";
import { clickhouse } from "@/lib/clickhouse/clickhouse";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const precision = Math.min(8, Math.max(1, parseInt(searchParams.get("precision") ?? "6", 10)));
  try {
    const [coverageRows, repeatersRs] = await Promise.all([
      getWardriveCoverage(precision),
      clickhouse.query({
        query: `
          SELECT
            substring(public_key, 1, 2) AS id,
            node_name                   AS name,
            latitude                    AS lat,
            longitude                   AS lon,
            last_seen
          FROM meshcore_adverts_latest
          WHERE is_repeater = 1
            AND latitude  IS NOT NULL
            AND longitude IS NOT NULL
          ORDER BY last_seen DESC
        `,
        format: "JSONEachRow",
      }),
    ]);

    const repeaters = (await repeatersRs.json()) as Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      last_seen: string;
    }>;

    const coverage = coverageRows.map((r) => ({
      hash: r.hash,
      received: r.received,
      lost: r.lost,
      samples: r.samples,
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
