import { NextRequest, NextResponse } from 'next/server';
import { streamCache } from '@/lib/clickhouse/stream-cache';

export async function GET(req: NextRequest) {
  const stats = streamCache.getStats();
  
  return NextResponse.json(stats, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET'
    }
  });
}
