import { NextResponse } from "next/server";
import { getNodePositions, getAllNodeNeighbors, putSample, WardriveSample } from "@/lib/clickhouse/actions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sample: WardriveSample = body
    sample.path = body.path.join('')
    await putSample(body);
    return NextResponse.json({ 
        result: "ok"
      }, { status: 200 });
  } catch (error) {
    console.error("Error while inserting:", error);
    
    // Check if it's a ClickHouse connection error
    if (error instanceof Error && error.message.includes('ClickHouse')) {
      return NextResponse.json({ 
        error: "Database temporarily unavailable",
        code: "DATABASE_ERROR"
      }, { status: 503 });
    }
    
    return NextResponse.json({ 
      error: "Error while inserting",
      code: "INTERNAL_ERROR"
    }, { status: 500 });
  }
} 