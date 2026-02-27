import { NextResponse } from "next/server";
import { clickhouse } from "@/lib/clickhouse/clickhouse";
import { generateRegionWhereClause } from "@/lib/regionFilters";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const region = searchParams.get("region") || undefined;
  const payloadType = searchParams.get("payloadType");
  const originFilter = searchParams.get("origin");
  const before = searchParams.get("before");
  const limit = Math.min(5000, Math.max(10, parseInt(searchParams.get("limit") || "100", 10)));

  const where: string[] = [];
  const params: Record<string, any> = { limit };

  if (before) {
    where.push("ingest_timestamp < {before:DateTime64}");
    params.before = before;
  }

  if (payloadType !== null && payloadType !== "") {
    const pt = parseInt(payloadType, 10);
    if (!isNaN(pt) && pt >= 0 && pt <= 255) {
      where.push("payload_type = {payloadType:UInt8}");
      params.payloadType = pt;
    }
  }

  if (originFilter && /^[0-9A-Fa-f]+$/.test(originFilter)) {
    where.push("hex(origin_pubkey) LIKE {originFilter:String}");
    params.originFilter = originFilter.toUpperCase() + "%";
  }

  const regionFilter = generateRegionWhereClause(region);
  if (regionFilter.whereClause) {
    where.push(regionFilter.whereClause);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const query = `
    SELECT
      ingest_timestamp,
      mesh_timestamp,
      broker,
      topic,
      hex(packet) AS packet,
      hex(payload) AS payload,
      path_len,
      hex(path) AS path,
      route_type,
      payload_type,
      payload_version,
      header,
      hex(origin_pubkey) AS origin_pubkey,
      message_hash,
      origin
    FROM meshcore_packets
    ${whereClause}
    ORDER BY ingest_timestamp DESC
    LIMIT {limit:UInt32}
  `;

  try {
    const rs = await clickhouse.query({ query, query_params: params, format: "JSONEachRow" });
    const packets = await rs.json();
    return NextResponse.json({ packets });
  } catch (error) {
    console.error("Error fetching packets:", error);
    return NextResponse.json({ error: "Failed to fetch packets" }, { status: 500 });
  }
}
