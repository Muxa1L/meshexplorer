import { describe, it, expect, vi } from 'vitest';

// Mock @clickhouse/client before importing regions (regions.ts imports clickhouse at module load)
vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({})),
}));

import {
  REGIONS,
  getRegionConfig,
  getRegionNames,
  getRegionFriendlyNames,
  getRegionDisplayName,
  getLocalizedRegionFriendlyNames,
  detectRegionFromBrokerTopic,
  detectRegion,
  generateRegionCondition,
  generateRegionArrayCondition,
} from '../regions';

const FIRST_REGION = REGIONS[0];
const SECOND_REGION = REGIONS[1];

describe('getRegionConfig', () => {
  it('returns the config for a valid region name', () => {
    const config = getRegionConfig(FIRST_REGION.name);
    expect(config).toBeDefined();
    expect(config!.name).toBe(FIRST_REGION.name);
  });

  it('returns undefined for an unknown region', () => {
    expect(getRegionConfig('nonexistent_region')).toBeUndefined();
  });
});

describe('getRegionNames', () => {
  it('returns an array of region name strings', () => {
    const names = getRegionNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(REGIONS.length);
  });

  it('includes all region names', () => {
    const names = getRegionNames();
    for (const region of REGIONS) {
      expect(names).toContain(region.name);
    }
  });
});

describe('getRegionFriendlyNames', () => {
  it('returns name and friendlyName pairs', () => {
    const pairs = getRegionFriendlyNames();
    expect(pairs).toHaveLength(REGIONS.length);
    for (const pair of pairs) {
      expect(pair).toHaveProperty('name');
      expect(pair).toHaveProperty('friendlyName');
    }
  });
});

describe('getRegionDisplayName', () => {
  it('returns translated name when available in "ru"', () => {
    const displayName = getRegionDisplayName(FIRST_REGION.name, 'ru');
    expect(typeof displayName).toBe('string');
    expect(displayName.length).toBeGreaterThan(0);
  });

  it('returns translated name when available in "en"', () => {
    const displayName = getRegionDisplayName(FIRST_REGION.name, 'en');
    expect(typeof displayName).toBe('string');
    expect(displayName.length).toBeGreaterThan(0);
  });

  it('falls back to friendlyName when no translation', () => {
    const displayName = getRegionDisplayName('nonexistent_region', 'en');
    expect(displayName).toBe('nonexistent_region');
  });

  it('uses "en" as default locale', () => {
    const withDefault = getRegionDisplayName(FIRST_REGION.name);
    const withEn = getRegionDisplayName(FIRST_REGION.name, 'en');
    expect(withDefault).toBe(withEn);
  });
});

describe('getLocalizedRegionFriendlyNames', () => {
  it('returns array with same length as REGIONS', () => {
    expect(getLocalizedRegionFriendlyNames()).toHaveLength(REGIONS.length);
  });

  it('each item has name and friendlyName', () => {
    const items = getLocalizedRegionFriendlyNames('ru');
    for (const item of items) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('friendlyName');
    }
  });
});

describe('detectRegionFromBrokerTopic', () => {
  it('returns null when broker is null', () => {
    expect(detectRegionFromBrokerTopic(null, FIRST_REGION.topics[0])).toBeNull();
  });

  it('returns null when topic is null', () => {
    expect(detectRegionFromBrokerTopic(FIRST_REGION.broker, null)).toBeNull();
  });

  it('returns the region name for a matching broker/topic pair', () => {
    const result = detectRegionFromBrokerTopic(FIRST_REGION.broker, FIRST_REGION.topics[0]);
    expect(result).toBe(FIRST_REGION.name);
  });

  it('returns null for mismatched broker', () => {
    const result = detectRegionFromBrokerTopic('tcp://wrong-broker:1234', FIRST_REGION.topics[0]);
    expect(result).toBeNull();
  });

  it('returns null for mismatched topic', () => {
    const result = detectRegionFromBrokerTopic(FIRST_REGION.broker, 'meshcore/nonexistent_topic');
    expect(result).toBeNull();
  });

  it('returns the correct region when multiple regions share the same broker', () => {
    // Both known regions use the same broker; verify each matches its own topic
    const result1 = detectRegionFromBrokerTopic(FIRST_REGION.broker, FIRST_REGION.topics[0]);
    const result2 = detectRegionFromBrokerTopic(SECOND_REGION.broker, SECOND_REGION.topics[0]);
    expect(result1).toBe(FIRST_REGION.name);
    expect(result2).toBe(SECOND_REGION.name);
  });
});

describe('detectRegion', () => {
  it('returns null when no MQTT topics and advert data is null', () => {
    expect(detectRegion([], null, null)).toBeNull();
  });

  it('detects region from MQTT topics list', () => {
    const mqttTopics = [{ broker: FIRST_REGION.broker, topic: FIRST_REGION.topics[0] }];
    expect(detectRegion(mqttTopics, null, null)).toBe(FIRST_REGION.name);
  });

  it('falls back to advert broker/topic when MQTT topics do not match', () => {
    const mqttTopics = [{ broker: 'tcp://other:1234', topic: 'unknown' }];
    const result = detectRegion(mqttTopics, FIRST_REGION.broker, FIRST_REGION.topics[0]);
    expect(result).toBe(FIRST_REGION.name);
  });

  it('prefers MQTT topics over advert data', () => {
    const mqttTopics = [{ broker: FIRST_REGION.broker, topic: FIRST_REGION.topics[0] }];
    // Advert data points to a different region
    const result = detectRegion(mqttTopics, SECOND_REGION.broker, SECOND_REGION.topics[0]);
    expect(result).toBe(FIRST_REGION.name);
  });

  it('returns null when neither MQTT topics nor advert data match', () => {
    const result = detectRegion(
      [{ broker: 'tcp://x:1', topic: 'no/match' }],
      'tcp://x:1',
      'no/match'
    );
    expect(result).toBeNull();
  });
});

describe('generateRegionCondition', () => {
  it('returns empty string for unknown region', () => {
    expect(generateRegionCondition('nonexistent')).toBe('');
  });

  it('includes broker and topic in the condition', () => {
    const condition = generateRegionCondition(FIRST_REGION.name);
    expect(condition).toContain(FIRST_REGION.broker);
    expect(condition).toContain(FIRST_REGION.topics[0]);
  });

  it('includes table alias when provided', () => {
    const condition = generateRegionCondition(FIRST_REGION.name, 't');
    expect(condition).toContain('t.broker');
    expect(condition).toContain('t.topic');
  });

  it('omits alias prefix when alias is empty string', () => {
    const condition = generateRegionCondition(FIRST_REGION.name, '');
    // should not contain table-alias dot patterns like "t.broker"
    expect(condition).not.toMatch(/\w+\.broker/);
    expect(condition).not.toMatch(/\w+\.topic/);
    expect(condition).toContain('broker');
    expect(condition).toContain('topic');
  });

  it('uses AND to join broker and topic clauses', () => {
    const condition = generateRegionCondition(FIRST_REGION.name);
    expect(condition).toMatch(/AND/);
  });
});

describe('generateRegionArrayCondition', () => {
  it('returns empty string for unknown region', () => {
    expect(generateRegionArrayCondition('nonexistent')).toBe('');
  });

  it('includes arrayExists and broker in the condition', () => {
    const condition = generateRegionArrayCondition(FIRST_REGION.name);
    expect(condition).toContain('arrayExists');
    expect(condition).toContain(FIRST_REGION.broker);
  });

  it('references x.4 for broker and x.5 for topic', () => {
    const condition = generateRegionArrayCondition(FIRST_REGION.name);
    expect(condition).toContain('x.4');
    expect(condition).toContain('x.5');
  });

  it('includes origin_path_info field name', () => {
    const condition = generateRegionArrayCondition(FIRST_REGION.name);
    expect(condition).toContain('origin_path_info');
  });
});
