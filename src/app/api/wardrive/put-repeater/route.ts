import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";

/**
 * POST /api/wardrive/put-repeater
 * Accepts repeater data from the MQTT scraper or manual additions.
 * Payload: { id: string, name: string, lat: number, lon: number, path?: string[] }
 * Compatible with the /put-repeater endpoint from nullrouten0/meshcore-coverage-map.
 *
 * The MQTT scraper sends this when it sees an ADVERT packet from a repeater node.
 * `id` is the first 2 hex chars of the node's public key.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, name, lat, lon } = body;

    if (!id || lat === undefined || lat === null || lon === undefined || lon === null) {
      return NextResponse.json(
        { error: "id, lat, and lon are required" },
        { status: 400 }
      );
    }

    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      return NextResponse.json(
        { error: "lat and lon must be valid numbers" },
        { status: 400 }
      );
    }

    await clickhouse.insert({
      table: "wardrive_repeaters",
      values: [
        {
          id: String(id),
          name: String(name ?? ""),
          lat: latNum,
          lon: lonNum,
          last_seen: Math.floor(Date.now() / 1000),
        },
      ],
      format: "JSONEachRow",
      columns: ["id", "name", "lat", "lon", "last_seen"],
    });

    return NextResponse.json(
      { success: true },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.error("Error storing repeater:", error);
    return NextResponse.json(
      { error: "Failed to store repeater" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
