import { NextResponse } from "next/server";
import { getWardriveCoverage } from "@/lib/clickhouse/actions";

/**
 * GET /api/wardrive/get-coverage
 * Returns an array of covered geohash tiles (precision 6).
 * Used by the wardrive app to determine which tiles already have coverage data
 * and whether the current position needs a ping.
 * Compatible with the /get-wardrive-coverage endpoint from nullrouten0/meshcore-coverage-map.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const precision = Math.min(8, Math.max(1, parseInt(searchParams.get("precision") ?? "6", 10)));
  try {
    const rows = await getWardriveCoverage(precision);
    const tiles = rows.map((r) => r.hash);
    return NextResponse.json(tiles, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("Error fetching wardrive coverage tiles:", error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
