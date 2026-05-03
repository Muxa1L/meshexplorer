import { describe, it, expect } from 'vitest';
import {
  getPathHashSizeBytes,
  splitPathHex,
  getPubkeyPrefix,
  getSupportedPubkeyPrefixes,
  groupPathsByStructure,
  buildTreeFromPathGroups,
  extractUniquePrefixes,
  SUPPORTED_PATH_HASH_SIZES,
} from '../pathUtils';

describe('SUPPORTED_PATH_HASH_SIZES', () => {
  it('contains 1, 2, and 3', () => {
    expect(SUPPORTED_PATH_HASH_SIZES).toEqual([1, 2, 3]);
  });
});

describe('getPathHashSizeBytes', () => {
  it('returns 1 for empty path', () => {
    expect(getPathHashSizeBytes('', 3)).toBe(1);
  });

  it('returns 1 when pathLen is 0', () => {
    expect(getPathHashSizeBytes('AABBCC', 0)).toBe(1);
  });

  it('returns 1 when pathLen is negative', () => {
    expect(getPathHashSizeBytes('AABBCC', -1)).toBe(1);
  });

  it('returns 1 when pathLen is undefined', () => {
    expect(getPathHashSizeBytes('AABBCC', undefined)).toBe(1);
  });

  it('calculates 1-byte hash size correctly', () => {
    // 3 hops × 2 hex chars/byte × 1 byte = 6 hex chars
    expect(getPathHashSizeBytes('AABBCC', 3)).toBe(1);
  });

  it('calculates 2-byte hash size correctly', () => {
    // 3 hops × 4 hex chars per hop = 12 hex chars → 2 bytes per hash
    expect(getPathHashSizeBytes('AABBCCDDEEFF', 3)).toBe(2);
  });

  it('calculates 3-byte hash size correctly', () => {
    // 2 hops × 6 hex chars = 12 hex chars
    expect(getPathHashSizeBytes('AABBCCDDEEFF', 2)).toBe(3);
  });

  it('returns 1 when hexCharsPerHop is not an integer', () => {
    // 5 chars / 2 hops = 2.5 → not integer
    expect(getPathHashSizeBytes('AABBC', 2)).toBe(1);
  });

  it('returns 1 when hexCharsPerHop is odd (not divisible by 2)', () => {
    // 6 chars / 2 hops = 3 → odd
    expect(getPathHashSizeBytes('AABBCC', 2)).toBe(1);
  });

  it('returns 1 when computed hash size exceeds 3', () => {
    // 8 chars / 1 hop = 8 chars per hop → 4 bytes → out of range
    expect(getPathHashSizeBytes('AABBCCDD', 1)).toBe(1);
  });

  it('is case-insensitive (normalizes to upper)', () => {
    expect(getPathHashSizeBytes('aabbcc', 3)).toBe(1);
  });

  it('trims whitespace before processing', () => {
    expect(getPathHashSizeBytes('  AABBCC  ', 3)).toBe(1);
  });
});

describe('splitPathHex', () => {
  it('returns empty array for empty string', () => {
    expect(splitPathHex('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitPathHex('   ')).toEqual([]);
  });

  it('splits 1-byte hash correctly (2 hex chars each)', () => {
    expect(splitPathHex('AABBCC', 3)).toEqual(['AA', 'BB', 'CC']);
  });

  it('splits 2-byte hash correctly (4 hex chars each)', () => {
    expect(splitPathHex('AABBCCDDEEFF', 3)).toEqual(['AABB', 'CCDD', 'EEFF']);
  });

  it('splits 3-byte hash correctly (6 hex chars each)', () => {
    expect(splitPathHex('AABBCCDDEEFF', 2)).toEqual(['AABBCC', 'DDEEFF']);
  });

  it('normalizes lowercase input to uppercase', () => {
    expect(splitPathHex('aabbcc', 3)).toEqual(['AA', 'BB', 'CC']);
  });

  it('drops trailing partial slice', () => {
    // 7 chars with 3 hops = 2.33 chars/hop → falls back to 1-byte (2 chars), drops last char
    expect(splitPathHex('AABBCCD', 3)).toEqual(['AA', 'BB', 'CC']);
  });

  it('uses pathLen = undefined (defaults to 1-byte slices)', () => {
    expect(splitPathHex('AABB')).toEqual(['AA', 'BB']);
  });
});

describe('getPubkeyPrefix', () => {
  it('returns empty string for empty pubkey', () => {
    expect(getPubkeyPrefix('')).toBe('');
  });

  it('returns first 2 hex chars for 1-byte hash (default)', () => {
    expect(getPubkeyPrefix('AABBCC')).toBe('AA');
  });

  it('returns first 4 hex chars for 2-byte hash', () => {
    expect(getPubkeyPrefix('AABBCC', 2)).toBe('AABB');
  });

  it('returns first 6 hex chars for 3-byte hash', () => {
    expect(getPubkeyPrefix('AABBCC', 3)).toBe('AABBCC');
  });

  it('uppercases the result', () => {
    expect(getPubkeyPrefix('aabbcc', 1)).toBe('AA');
  });

  it('treats hashSizeBytes = 0 as 1', () => {
    expect(getPubkeyPrefix('AABBCC', 0)).toBe('AA');
  });

  it('treats negative hashSizeBytes as 1', () => {
    expect(getPubkeyPrefix('AABBCC', -1)).toBe('AA');
  });
});

describe('getSupportedPubkeyPrefixes', () => {
  it('returns prefixes for all supported hash sizes', () => {
    const prefixes = getSupportedPubkeyPrefixes('AABBCCDDEEFF');
    expect(prefixes).toEqual(['AA', 'AABB', 'AABBCC']);
  });

  it('returns array of length 3', () => {
    expect(getSupportedPubkeyPrefixes('AABBCCDDEEFF')).toHaveLength(3);
  });
});

describe('groupPathsByStructure', () => {
  it('returns empty array for empty input', () => {
    expect(groupPathsByStructure([])).toEqual([]);
  });

  it('groups identical path structures together', () => {
    const paths = [
      { origin: 'node1', pubkey: 'AABBCCDDEEFF', path: 'AABBCC', pathLen: 3 },
      { origin: 'node2', pubkey: 'AABBCCDDEEFF', path: 'AABBCC', pathLen: 3 },
    ];
    const groups = groupPathsByStructure(paths);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].indices).toEqual([0, 1]);
  });

  it('creates separate groups for different path structures', () => {
    const paths = [
      { origin: 'node1', pubkey: 'AABBCCDDEEFF', path: 'AABBCC', pathLen: 3 },
      { origin: 'node2', pubkey: '1122334455FF', path: '112233', pathLen: 3 },
    ];
    const groups = groupPathsByStructure(paths);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(1);
    expect(groups[1].count).toBe(1);
  });

  it('includes the pubkey prefix as the last slice', () => {
    // path='CCDD', pathLen=1 → 4 chars/1 hop = 4 chars/hop = 2 bytes hash
    // pubkey prefix at 2 bytes = first 4 chars of pubkey uppercased = 'AABB'
    const paths = [
      { origin: 'node1', pubkey: 'AABBCCDDEEFF', path: 'CCDD', pathLen: 1 },
    ];
    const groups = groupPathsByStructure(paths);
    expect(groups[0].pathSlices).toContain('AABB'); // pubkey prefix (2-byte because path is 2-byte)
  });
});

describe('buildTreeFromPathGroups', () => {
  it('returns root node with ?? name when no initiating key provided', () => {
    const groups = [
      { path: 'AABB', pathSlices: ['AA', 'BB'], indices: [0], count: 1 },
    ];
    const tree = buildTreeFromPathGroups(groups);
    expect(tree.name).toBe('??');
  });

  it('uses initiating node key for root name', () => {
    const groups = [
      { path: 'AABB', pathSlices: ['AA', 'BB'], indices: [0], count: 1 },
    ];
    const tree = buildTreeFromPathGroups(groups, 'AABBCCDD');
    expect(tree.name).toBe('AA');
  });

  it('builds correct child hierarchy', () => {
    const groups = [
      { path: 'AABBCC', pathSlices: ['AA', 'BB', 'CC'], indices: [0], count: 1 },
    ];
    const tree = buildTreeFromPathGroups(groups, 'AABBCCDD');
    expect(tree.children).toHaveLength(1);
    expect(tree.children![0].name).toBe('AA');
    expect(tree.children![0].children![0].name).toBe('BB');
    expect(tree.children![0].children![0].children![0].name).toBe('CC');
  });

  it('merges shared prefixes into the same branch', () => {
    const groups = [
      { path: 'AABB', pathSlices: ['AA', 'BB'], indices: [0], count: 1 },
      { path: 'AACC', pathSlices: ['AA', 'CC'], indices: [1], count: 1 },
    ];
    const tree = buildTreeFromPathGroups(groups, 'AABBCCDD');
    // Both paths start with 'AA', so root should have one child 'AA'
    expect(tree.children).toHaveLength(1);
    expect(tree.children![0].name).toBe('AA');
    // Under 'AA' we should have two children: 'BB' and 'CC'
    expect(tree.children![0].children).toHaveLength(2);
  });

  it('returns root with empty children for empty groups', () => {
    const tree = buildTreeFromPathGroups([]);
    expect(tree.name).toBe('??');
    expect(tree.children).toEqual([]);
  });
});

describe('extractUniquePrefixes', () => {
  it('returns empty array for null input', () => {
    expect(extractUniquePrefixes(null)).toEqual([]);
  });

  it('returns root name for leaf node', () => {
    expect(extractUniquePrefixes({ name: 'AA' })).toEqual(['AA']);
  });

  it('returns all unique node names in the tree', () => {
    const tree = {
      name: 'root',
      children: [
        { name: 'AA', children: [{ name: 'BB' }] },
        { name: 'CC' },
      ],
    };
    const prefixes = extractUniquePrefixes(tree);
    expect(prefixes).toContain('root');
    expect(prefixes).toContain('AA');
    expect(prefixes).toContain('BB');
    expect(prefixes).toContain('CC');
    expect(prefixes).toHaveLength(4);
  });

  it('deduplicates repeated node names', () => {
    const tree = {
      name: 'root',
      children: [
        { name: 'AA' },
        { name: 'AA' }, // duplicate
      ],
    };
    const prefixes = extractUniquePrefixes(tree);
    expect(prefixes.filter(p => p === 'AA')).toHaveLength(1);
  });
});
