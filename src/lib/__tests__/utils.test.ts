import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn', () => {
  it('returns a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('joins multiple classes with a space', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('omits falsy values', () => {
    expect(cn('foo', false, undefined, null, '')).toBe('foo');
  });

  it('handles conditional classes via an object', () => {
    expect(cn({ foo: true, bar: false })).toBe('foo');
  });

  it('merges conflicting Tailwind classes (last wins)', () => {
    // tailwind-merge: later p-4 should override p-2
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('returns empty string for no arguments', () => {
    expect(cn()).toBe('');
  });

  it('handles arrays of class names', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });
});
