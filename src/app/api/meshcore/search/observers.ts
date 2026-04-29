import { NextResponse } from "next/server";
import { searchMeshcoreObservers } from "@/lib/clickhouse/actions";

interface ObserverSearchQueryParams {
  query?: string;
  region?: string;
  lastSeen?: string | null;
  limit: number;
  exact: boolean;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.queries)) {
      return NextResponse.json({
        error: "Body must contain a 'queries' array",
        code: "INVALID_BODY"
      }, { status: 400 });
    }
    if (body.queries.length === 0) {
      return NextResponse.json({
        results: [],
        total: 0
      });
    }
    if (body.queries.length > 500) {
      return NextResponse.json({
        error: "Maximum 500 queries allowed per batch",
        code: "TOO_MANY_QUERIES"
      }, { status: 400 });
    }
    const normalizedQueries: ObserverSearchQueryParams[] = body.queries.map((queryObj: any, index: number) => {
      const limit = parseInt(queryObj.limit || "50", 10);
      if (limit < 1 || limit > 200) {
        throw new Error(`Query ${index}: Limit must be between 1 and 200`);
      }
      if (queryObj.query && queryObj.query.length > 100) {
        throw new Error(`Query ${index}: Query too long (max 100 characters)`);
      }
      let lastSeenValue: string | null = null;
      if (queryObj.lastSeen !== null && queryObj.lastSeen !== undefined) {
        const lastSeenNum = parseInt(queryObj.lastSeen, 10);
        if (isNaN(lastSeenNum) || lastSeenNum < 0) {
          throw new Error(`Query ${index}: lastSeen must be a positive number (seconds)`);
        }
        lastSeenValue = queryObj.lastSeen.toString();
      }
      return {
        query: queryObj.query?.trim() || undefined,
        region: queryObj.region || undefined,
        lastSeen: lastSeenValue,
        limit,
        exact: Boolean(queryObj.exact)
      };
    });
    const results = await Promise.all(normalizedQueries.map(q => searchMeshcoreObservers(q)));
    const formattedResults = results.map(r => r || []);
    return NextResponse.json({
      results: formattedResults
    });
  } catch (error) {
    console.error("Error in observer batch search:", error);
    if (error instanceof Error && error.message.includes('Query ')) {
      return NextResponse.json({
        error: error.message,
        code: "VALIDATION_ERROR"
      }, { status: 400 });
    }
    if (error instanceof Error && error.message.includes('ClickHouse')) {
      return NextResponse.json({
        error: "Database temporarily unavailable",
        code: "DATABASE_ERROR"
      }, { status: 503 });
    }
    return NextResponse.json({
      error: "Failed to execute observer batch search",
      code: "INTERNAL_ERROR"
    }, { status: 500 });
  }
}
