import { describe, expect, it } from 'vitest';
import { calculateDelta, formatDuration, formatImpact, formatKb, formatNumber, formatPercent } from '../src/format.js';

describe('format utility using Intl.NumberFormat', () => {
  it('formats numbers with digit grouping and precision', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567.89, { decimals: 2 })).toBe('1,234,567.89');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(null as any)).toBe('0');
  });

  it('formats percentages with explicit signs and decimal precision', () => {
    expect(formatPercent(-83.333)).toBe('-83.3%');
    expect(formatPercent(35.8, { showSign: true })).toBe('+35.8%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(-0.5161, { isFraction: true, decimals: 2 })).toBe('-51.61%');
  });

  it('formats bytes into KB with grouping and units', () => {
    expect(formatKb(1024)).toBe('1.00 KB');
    expect(formatKb(5941125, 2)).toBe('5,801.88 KB');
    expect(formatKb(5941125, { decimals: 1 })).toBe('5,801.9 KB');
    expect(formatKb(5941125, { unit: false })).toBe('5,801.88');
  });

  it('formats duration in milliseconds', () => {
    expect(formatDuration(14.5)).toBe('14.50 ms');
    expect(formatDuration(0.05, { decimals: 2 })).toBe('0.05 ms');
    expect(formatDuration(1200, { decimals: 0 })).toBe('1,200 ms');
  });

  it('calculates numerical delta and percentage change accurately', () => {
    const delta = calculateDelta(3000, 500);
    expect(delta.diff).toBe(-2500);
    expect(delta.percent).toBeCloseTo(-83.33, 1);
    expect(delta.formattedPercent).toBe('-83.3%');
    expect(delta.isReduction).toBe(true);
  });

  it('formats impact strings preserving existing signature compatibility', () => {
    expect(formatImpact(-73728, -8.96)).toContain('-72.00 KB');
    expect(formatImpact(-73728, -8.96)).toContain('(-8.96%)');
    expect(formatImpact(0, 0)).toBe('n/a');
  });
});
