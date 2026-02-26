// Inline geohash utilities - no external dependency needed for browser use

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lon: number, precision: number): string {
  let idx = 0, bit = 0, evenBit = true, geohash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (geohash.length < precision) {
    if (evenBit) {
      const m = (lonMin + lonMax) / 2;
      if (lon >= m) { idx |= 1 << (4 - bit); lonMin = m; } else { lonMax = m; }
    } else {
      const m = (latMin + latMax) / 2;
      if (lat >= m) { idx |= 1 << (4 - bit); latMin = m; } else { latMax = m; }
    }
    evenBit = !evenBit;
    if (bit < 4) { bit++; } else { geohash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return geohash;
}

export function geohashDecodeBbox(hash: string): [number, number, number, number] {
  let evenBit = true;
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  for (let i = 0; i < hash.length; i++) {
    const idx = BASE32.indexOf(hash[i]);
    for (let n = 4; n >= 0; n--) {
      const b = (idx >> n) & 1;
      if (evenBit) {
        const m = (lonMin + lonMax) / 2;
        if (b === 1) { lonMin = m; } else { lonMax = m; }
      } else {
        const m = (latMin + latMax) / 2;
        if (b === 1) { latMin = m; } else { latMax = m; }
      }
      evenBit = !evenBit;
    }
  }
  return [latMin, lonMin, latMax, lonMax];
}

export function geohashDecodeCenter(hash: string): [number, number] {
  const [latMin, lonMin, latMax, lonMax] = geohashDecodeBbox(hash);
  return [(latMin + latMax) / 2, (lonMin + lonMax) / 2];
}

/** Geohash at precision 6 — coverage tile */
export function coverageKey(lat: number, lon: number): string {
  return geohashEncode(lat, lon, 6);
}

/** Geohash at precision 8 — sample key */
export function sampleKey(lat: number, lon: number): string {
  return geohashEncode(lat, lon, 8);
}

export function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
