// Adapted from mintylinux/meshwar-map/functions/api/samples.js
// In-memory store version for this project. Not persistent across restarts.

import { NextResponse } from "next/server";
import { getWardriveCoveragePings, upsertWardriveCoverage, putSample } from "@/lib/clickhouse/actions";
import { clickhouse } from "@/lib/clickhouse/clickhouse";

// no in-memory seen data; we persist seen IDs in ClickHouse via wardrive_seen table


// geohash helpers (same as external)
const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function encodeGeohash(lat: number, lon: number, precision = 7) {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon > lonMid) { idx |= (1 << (4 - bit)); lonMin = lonMid; } else { lonMax = lonMid; }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat > latMid) { idx |= (1 << (4 - bit)); latMin = latMid; } else { latMax = latMid; }
    }
    evenBit = !evenBit;
    if (bit < 4) { bit++; } else { geohash += base32[idx]; bit = 0; idx = 0; }
  }
  return geohash;
}

function ageInDays(timestamp: string) {
  const now = new Date();
  const sampleDate = new Date(timestamp);
  const diffMs = now.getTime() - sampleDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function applyDecay(cell: any) {
  const age = ageInDays(cell.lastUpdate);
  let decayFactor = 1.0;
  if (age > 90) decayFactor = 0.2;
  else if (age > 30) decayFactor = 0.5;
  else if (age > 14) decayFactor = 0.7;
  else if (age > 7) decayFactor = 0.85;
  cell.received *= decayFactor;
  cell.lost *= decayFactor;
  return cell;
}

function aggregateSamples(samples: any[]) {
  const coverage: Record<string, any> = {};
  const now = new Date().toISOString();
  samples.forEach(sample => {
    const lat = sample.latitude || sample.lat;
    const lng = sample.longitude || sample.lon;
    if (!lat || !lng) return;
    const hash = encodeGeohash(lat, lng, 10);
    if (!coverage[hash]) {
      coverage[hash] = {
        hash,
        received: 0,
        lost: 0,
        samples: 0,
        repeaters: {},
        firstSeen: sample.timestamp || now,
        lastUpdate: sample.timestamp || now,
        appVersion: sample.appVersion || 'unknown'
      };
    }
    const success = sample.pingSuccess === true || (sample.nodeId && sample.nodeId !== 'Unknown');
    const failed = sample.pingSuccess === false || sample.nodeId === 'Unknown';
    if (sample.appVersion && sample.timestamp >= coverage[hash].lastUpdate) {
      coverage[hash].appVersion = sample.appVersion;
    }
    if (success) {
      coverage[hash].received += 1;
      if (sample.path && sample.path !== 'Unknown') {
        const nodeId = sample.path;
        const sampleTime = new Date(sample.timestamp || now).getTime();
        if (!coverage[hash].repeaters[nodeId] || new Date(coverage[hash].repeaters[nodeId].lastSeen).getTime() < sampleTime) {
          coverage[hash].repeaters[nodeId] = {
            name: sample.repeaterName || nodeId,
            rssi: sample.rssi || null,
            snr: sample.snr || null,
            lastSeen: sample.timestamp || now
          };
        }
      }
    } else if (failed) {
      coverage[hash].lost += 1;
    }
    coverage[hash].samples += 1;
    if (sample.timestamp > coverage[hash].lastUpdate) {
      coverage[hash].lastUpdate = sample.timestamp;
    }
  });
  return coverage;
}

function computeSampleId(sample: any) {
  if (sample.id) return String(sample.id);
  const lat = sample.latitude ?? sample.lat;
  const lng = sample.longitude ?? sample.lng;
  const ts = sample.timestamp || '';
  const node = sample.nodeId || '';
  const key = `${lat?.toFixed?.(6)}|${lng?.toFixed?.(6)}|${ts}|${node}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h) + key.charCodeAt(i);
    h |= 0;
  }
  return `h${Math.abs(h)}`;
}

export async function GET(req: Request) {
  // optional precision query param for geohash resolution
  const url = new URL(req.url);
  const precis = parseInt(url.searchParams.get('precision') || '10', 10) || 10;
  // fetch persisted coverage from ClickHouse at requested resolution
  const rows = await getWardriveCoveragePings(precis);
  // convert array to object by hash for compatibility
  const coverage: Record<string, any> = {};
  rows.forEach(r => {
    coverage[r.hash] = {
      received: r.received,
      lost: r.lost,
      samples: r.samples,
      repeaters: typeof r.repeaters === 'string' ? JSON.parse(r.repeaters) : r.repeaters,
      lastUpdate: r.lastUpdate,
      appVersion: r.appVersion
    };
  });
  return NextResponse.json({ coverage }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // console.info('Received samples POST request', body );
    if (!body.samples || !Array.isArray(body.samples)) {
      return NextResponse.json({ error: 'Invalid request: samples array required' }, { status: 400 });
    }
    const incoming = body.samples;
    const batchUnique: any[] = [];
    const batchIds = new Set<string>();
    for (const s of incoming) {
      const sid = computeSampleId(s);
      if (batchIds.has(sid)) continue;
      batchIds.add(sid);
      batchUnique.push({ ...s, __id: sid });
    }
    // filter already seen using database
    const deduped: any[] = [];
    for (const s of batchUnique) {
      const seen = await import("@/lib/clickhouse/actions").then(m => m.hasSeenId(s.__id));
      if (!seen) {
        deduped.push(s);
        await import("@/lib/clickhouse/actions").then(m => m.markSeenId(s.__id));
      }
    }
    const newCoverage = aggregateSamples(deduped);
    // persist coverage to ClickHouse
    await upsertWardriveCoverage(newCoverage as any);
    // optionally store raw samples as well
    for (const s of deduped) {
      try { await putSample({ lat: s.latitude || s.lat, lon: s.longitude || s.lng }); } catch(e) {}
    }
    return NextResponse.json({
      success: true,
      receivedAt: new Date().toISOString(),
      samplesReceived: incoming.length,
      samplesDeduped: incoming.length - deduped.length,
      samplesProcessed: deduped.length
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (error: any) {
    console.error('samples POST error', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  // optionally check auth header but leaving open for now
  // clear persisted coverage by truncating table
  try {
    await clickhouse.query({ query: 'TRUNCATE TABLE IF EXISTS wardrive_coverage' });
    // also clear seen IDs so dedup logic starts fresh
    await clickhouse.query({ query: 'TRUNCATE TABLE IF EXISTS wardrive_seen' });
  } catch (e) {
    console.error('failed to truncate wardrive data', e);
  }
  return NextResponse.json({ success: true, message: 'All data cleared' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }});
}
