import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";

// Geohash encoder for server-side prefix filtering
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function encodeGeohash(lat: number, lon: number, precision: number): string {
  let idx = 0,
    bit = 0,
    evenBit = true,
    geohash = "";
  let latMin = -90,
    latMax = 90,
    lonMin = -180,
    lonMax = 180;
  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        idx |= 1 << (4 - bit);
        lonMin = lonMid;
      } else {
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx |= 1 << (4 - bit);
        latMin = latMid;
      } else {
        latMax = latMid;
      }
    }
    evenBit = !evenBit;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return geohash;
}

/**
 * GET /api/wardrive/get-samples
 * Returns individual wardrive samples stored in ClickHouse.
 * Supports optional geohash prefix filtering via ?p=<prefix> query param.
 * Compatible with the /get-samples?p=<prefix> endpoint from nullrouten0/meshcore-coverage-map.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const prefix = url.searchParams.get("p") ?? "";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "10000", 10),
      50000
    );

    const rs = await clickhouse.query({
      query: `
        SELECT
          lat,
          lon,
          path,
          snr,
          rssi,
          ingest_timestamp AS timestamp
        FROM wardrive_samples
        ORDER BY ingest_timestamp DESC
        LIMIT ${limit}
      `,
      format: "JSONEachRow",
    });

    let samples = (await rs.json()) as Array<{
      lat: number;
      lon: number;
      path: string;
      snr: number;
      rssi: number;
      timestamp: string;
    }>;

    // Filter by geohash prefix if specified
    if (prefix) {
      const len = prefix.length;
      samples = samples.filter((s) => {
        if (s.lat == null || s.lon == null) return false;
        return encodeGeohash(s.lat, s.lon, len) === prefix;
      });
    }

    return NextResponse.json(samples, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.error("Error fetching wardrive samples:", error);
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
