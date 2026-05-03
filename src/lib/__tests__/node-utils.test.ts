import { describe, it, expect } from 'vitest';
import {
  createNodeSearchUrl,
  processNodeMentionsForMarkdown,
  extractNodeMentions,
  hasNodeMentions,
  findNodeMentions,
} from '../node-utils';

describe('createNodeSearchUrl', () => {
  it('generates a URL with the encoded node name', () => {
    const url = createNodeSearchUrl('MyNode');
    expect(url).toBe('https://map.w0z.is/search?q=MyNode&exact&redirect');
  });

  it('percent-encodes spaces', () => {
    const url = createNodeSearchUrl('My Node');
    expect(url).toContain('My%20Node');
  });

  it('percent-encodes special characters', () => {
    const url = createNodeSearchUrl('Node & <Test>');
    expect(url).toContain('Node%20%26%20%3CTest%3E');
  });

  it('handles empty string', () => {
    const url = createNodeSearchUrl('');
    expect(url).toBe('https://map.w0z.is/search?q=&exact&redirect');
  });
});

describe('processNodeMentionsForMarkdown', () => {
  it('converts @[NodeName] to a markdown link', () => {
    const result = processNodeMentionsForMarkdown('Hello @[Alice]!');
    expect(result).toBe('Hello [@Alice](https://map.w0z.is/search?q=Alice&exact&redirect)!');
  });

  it('handles text with no mentions unchanged', () => {
    const text = 'No mentions here';
    expect(processNodeMentionsForMarkdown(text)).toBe(text);
  });

  it('handles multiple mentions in the same string', () => {
    const result = processNodeMentionsForMarkdown('@[Alice] and @[Bob]');
    expect(result).toContain('[@Alice]');
    expect(result).toContain('[@Bob]');
  });

  it('handles mention with special characters in name', () => {
    const result = processNodeMentionsForMarkdown('@[Node 1]');
    expect(result).toContain('[@Node 1]');
    expect(result).toContain('Node%201');
  });

  it('handles empty string', () => {
    expect(processNodeMentionsForMarkdown('')).toBe('');
  });

  it('does not modify @name patterns without brackets', () => {
    const text = 'Hello @alice';
    expect(processNodeMentionsForMarkdown(text)).toBe(text);
  });

  it('handles adjacent mentions', () => {
    const result = processNodeMentionsForMarkdown('@[A]@[B]');
    expect(result).toContain('[@A]');
    expect(result).toContain('[@B]');
  });
});

describe('extractNodeMentions', () => {
  it('extracts a single mention', () => {
    expect(extractNodeMentions('Hello @[Alice]!')).toEqual(['Alice']);
  });

  it('returns empty array when no mentions', () => {
    expect(extractNodeMentions('No mentions here')).toEqual([]);
  });

  it('extracts multiple mentions', () => {
    const names = extractNodeMentions('@[Alice] and @[Bob]');
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('extracts mentions with spaces in the name', () => {
    expect(extractNodeMentions('@[Node One]')).toEqual(['Node One']);
  });

  it('handles empty string', () => {
    expect(extractNodeMentions('')).toEqual([]);
  });

  it('does not extract @name patterns without brackets', () => {
    expect(extractNodeMentions('@alice')).toEqual([]);
  });
});

describe('hasNodeMentions', () => {
  it('returns true when a mention is present', () => {
    expect(hasNodeMentions('Hello @[Alice]')).toBe(true);
  });

  it('returns false when no mentions', () => {
    expect(hasNodeMentions('No mentions')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasNodeMentions('')).toBe(false);
  });

  it('returns false for @name without brackets', () => {
    expect(hasNodeMentions('@alice')).toBe(false);
  });

  it('returns true for mention anywhere in the string', () => {
    expect(hasNodeMentions('Start @[Node] end')).toBe(true);
  });
});

describe('findNodeMentions', () => {
  it('returns empty array for text with no mentions', () => {
    expect(findNodeMentions('no mentions')).toEqual([]);
  });

  it('returns correct info for a single mention', () => {
    const result = findNodeMentions('Hello @[Alice] world');
    expect(result).toHaveLength(1);
    expect(result[0].nodeName).toBe('Alice');
    expect(result[0].originalMatch).toBe('@[Alice]');
    expect(result[0].startIndex).toBe(6);
    expect(result[0].endIndex).toBe(14);
  });

  it('returns correct positions for multiple mentions', () => {
    const text = '@[A] @[B]';
    const result = findNodeMentions(text);
    expect(result).toHaveLength(2);
    expect(result[0].nodeName).toBe('A');
    expect(result[0].startIndex).toBe(0);
    expect(result[1].nodeName).toBe('B');
    expect(result[1].startIndex).toBe(5);
  });

  it('endIndex equals startIndex + length of originalMatch', () => {
    const result = findNodeMentions('@[LongNodeName]');
    expect(result[0].endIndex).toBe(result[0].startIndex + result[0].originalMatch.length);
  });

  it('handles mentions with spaces', () => {
    const result = findNodeMentions('@[Node One]');
    expect(result[0].nodeName).toBe('Node One');
  });
});
