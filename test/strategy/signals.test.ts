import { describe, it, expect } from 'vitest';
import { detectCrossover } from '../../src/strategy/signals';

describe('detectCrossover', () => {
  it('returns BUY when EMA9 crosses above EMA21', () => {
    // Previous: ema9 <= ema21, Current: ema9 > ema21
    const ema9 = [100, 105]; // crossed above
    const ema21 = [102, 103]; // stayed below
    const result = detectCrossover(ema9, ema21, 'XXBTZEUR', 64000, Date.now());
    expect(result.signal).toBe('BUY');
  });

  it('returns SELL when EMA9 crosses below EMA21', () => {
    // Previous: ema9 >= ema21, Current: ema9 < ema21
    const ema9 = [105, 100]; // crossed below
    const ema21 = [103, 102];
    const result = detectCrossover(ema9, ema21, 'XXBTZEUR', 63000, Date.now());
    expect(result.signal).toBe('SELL');
  });

  it('returns HOLD when no crossover', () => {
    // EMA9 stays above EMA21
    const ema9 = [105, 106];
    const ema21 = [100, 101];
    const result = detectCrossover(ema9, ema21, 'XXBTZEUR', 64000, Date.now());
    expect(result.signal).toBe('HOLD');
  });

  it('returns HOLD when arrays too short', () => {
    const result = detectCrossover([100], [90], 'XXBTZEUR', 64000, Date.now());
    expect(result.signal).toBe('HOLD');
  });

  it('BUY at exact boundary (prevEma9 == prevEma21)', () => {
    const ema9 = [100, 101]; // was equal, now above
    const ema21 = [100, 100];
    const result = detectCrossover(ema9, ema21, 'XETHZEUR', 3500, Date.now());
    expect(result.signal).toBe('BUY');
  });

  it('SELL at exact boundary (prevEma9 == prevEma21)', () => {
    const ema9 = [100, 99]; // was equal, now below
    const ema21 = [100, 100];
    const result = detectCrossover(ema9, ema21, 'XETHZEUR', 3400, Date.now());
    expect(result.signal).toBe('SELL');
  });

  it('includes correct metadata in result', () => {
    const ema9 = [100, 105];
    const ema21 = [102, 103];
    const result = detectCrossover(ema9, ema21, 'XXBTZEUR', 64500, 1720000000);
    expect(result.pair).toBe('XXBTZEUR');
    expect(result.ema9).toBe(105);
    expect(result.ema21).toBe(103);
    expect(result.closePrice).toBe(64500);
    expect(result.timestamp).toBe(1720000000);
  });
});
