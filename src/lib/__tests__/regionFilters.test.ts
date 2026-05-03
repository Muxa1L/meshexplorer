import { describe, it, expect, vi } from 'vitest';

// Mock @clickhouse/client before importing anything that transitively loads it
vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({})),
}));

import {
  generateRegionWhereClause,
  generateRegionWhereClauseFromArray,
  generateRegionConditionForStreaming,
  generateRegionArrayConditionForStreaming,
} from '../regionFilters';
import { REGIONS } from '../regions';

const FIRST_REGION = REGIONS[0];

describe('generateRegionWhereClause', () => {
  it('returns empty clause and params when region is undefined', () => {
    const result = generateRegionWhereClause(undefined);
    expect(result.whereClause).toBe('');
    expect(result.params).toEqual({});
  });

  it('returns a non-empty clause for a valid region', () => {
    const result = generateRegionWhereClause(FIRST_REGION.name);
    expect(result.whereClause).not.toBe('');
    expect(result.params).toEqual({});
  });

  it('includes broker and topic from the region config', () => {
    const result = generateRegionWhereClause(FIRST_REGION.name);
    expect(result.whereClause).toContain(FIRST_REGION.broker);
    expect(result.whereClause).toContain(FIRST_REGION.topics[0]);
  });

  it('uses the table alias when provided', () => {
    const result = generateRegionWhereClause(FIRST_REGION.name, 'p');
    expect(result.whereClause).toContain('p.broker');
    expect(result.whereClause).toContain('p.topic');
  });

  it('returns empty clause for an unknown region', () => {
    const result = generateRegionWhereClause('unknown_region');
    expect(result.whereClause).toBe('');
  });
});

describe('generateRegionWhereClauseFromArray', () => {
  it('returns empty clause and params when region is undefined', () => {
    const result = generateRegionWhereClauseFromArray(undefined);
    expect(result.whereClause).toBe('');
    expect(result.params).toEqual({});
  });

  it('returns a non-empty clause for a valid region', () => {
    const result = generateRegionWhereClauseFromArray(FIRST_REGION.name);
    expect(result.whereClause).not.toBe('');
    expect(result.params).toEqual({});
  });

  it('clause contains arrayExists', () => {
    const result = generateRegionWhereClauseFromArray(FIRST_REGION.name);
    expect(result.whereClause).toContain('arrayExists');
  });

  it('returns empty clause for an unknown region', () => {
    const result = generateRegionWhereClauseFromArray('unknown_region');
    expect(result.whereClause).toBe('');
  });
});

describe('generateRegionConditionForStreaming', () => {
  it('returns empty string when region is undefined', () => {
    expect(generateRegionConditionForStreaming(undefined)).toBe('');
  });

  it('returns a non-empty condition for a valid region', () => {
    const condition = generateRegionConditionForStreaming(FIRST_REGION.name);
    expect(condition).not.toBe('');
    expect(condition).toContain(FIRST_REGION.broker);
  });

  it('returns empty string for an unknown region', () => {
    expect(generateRegionConditionForStreaming('unknown')).toBe('');
  });
});

describe('generateRegionArrayConditionForStreaming', () => {
  it('returns empty string when region is undefined', () => {
    expect(generateRegionArrayConditionForStreaming(undefined)).toBe('');
  });

  it('returns a non-empty condition for a valid region', () => {
    const condition = generateRegionArrayConditionForStreaming(FIRST_REGION.name);
    expect(condition).not.toBe('');
    expect(condition).toContain('arrayExists');
  });

  it('returns empty string for an unknown region', () => {
    expect(generateRegionArrayConditionForStreaming('unknown')).toBe('');
  });
});
