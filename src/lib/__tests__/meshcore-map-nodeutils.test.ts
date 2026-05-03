import { describe, it, expect } from 'vitest';
import { getColourForName, getNameIconLabel } from '../meshcore-map-nodeutils';

describe('getColourForName', () => {
  it('returns an HSL colour string', () => {
    const colour = getColourForName('TestNode');
    expect(colour).toMatch(/^hsl\(\d+deg, \d+%, \d+%\)$/);
  });

  it('uses default saturation of 60 and lightness of 50', () => {
    const colour = getColourForName('TestNode');
    expect(colour).toContain('60%');
    expect(colour).toContain('50%');
  });

  it('uses custom saturation and lightness', () => {
    const colour = getColourForName('TestNode', 80, 70);
    expect(colour).toContain('80%');
    expect(colour).toContain('70%');
  });

  it('returns the same colour for the same name', () => {
    expect(getColourForName('Node')).toBe(getColourForName('Node'));
  });

  it('returns different colours for different names', () => {
    // Not guaranteed but highly likely given FNV-1a distribution
    const colours = new Set(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map(getColourForName));
    expect(colours.size).toBeGreaterThan(1);
  });

  it('handles empty string without throwing', () => {
    expect(() => getColourForName('')).not.toThrow();
    expect(getColourForName('')).toMatch(/^hsl\(\d+deg, \d+%, \d+%\)$/);
  });

  it('hue is within 0–359 range', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Delta', '123', '!!@@'];
    for (const name of names) {
      const colour = getColourForName(name);
      const match = colour.match(/hsl\((\d+)deg/);
      expect(match).not.toBeNull();
      const hue = parseInt(match![1], 10);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

describe('getNameIconLabel', () => {
  it('returns the name unchanged for non-empty strings', () => {
    expect(getNameIconLabel('Alice')).toBe('Alice');
  });

  it('returns empty string for empty input', () => {
    expect(getNameIconLabel('')).toBe('');
  });

  it('returns single character unchanged', () => {
    expect(getNameIconLabel('A')).toBe('A');
  });

  it('returns multi-word name unchanged', () => {
    expect(getNameIconLabel('Node Alpha')).toBe('Node Alpha');
  });
});
