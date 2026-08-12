import { describe, it, expect } from 'vitest';
import { computeEMA } from '../../src/strategy/ema';

describe('computeEMA', () => {
  it('returns empty array if prices length < period', () => {
    expect(computeEMA([1, 2, 3], 5)).toEqual([]);
  });

  it('returns empty array if period < 1', () => {
    expect(computeEMA([1, 2, 3], 0)).toEqual([]);
  });

  it('computes correct EMA for simple case', () => {
    // Period 3, prices [2, 4, 6, 8, 10]
    // SMA seed = (2+4+6)/3 = 4
    // k = 2/(3+1) = 0.5
    // EMA[1] = 8*0.5 + 4*0.5 = 6
    // EMA[2] = 10*0.5 + 6*0.5 = 8
    const result = computeEMA([2, 4, 6, 8, 10], 3);
    expect(result.length).toBe(3); // 5 - 3 + 1
    expect(result[0]).toBeCloseTo(4, 10);
    expect(result[1]).toBeCloseTo(6, 10);
    expect(result[2]).toBeCloseTo(8, 10);
  });

  it('output length is prices.length - period + 1', () => {
    const prices = [10, 20, 30, 40, 50, 60, 70];
    const result = computeEMA(prices, 3);
    expect(result.length).toBe(7 - 3 + 1); // 5
  });

  it('first EMA value equals SMA of first N prices', () => {
    const prices = [10, 20, 30, 40, 50];
    const result = computeEMA(prices, 4);
    // SMA = (10+20+30+40)/4 = 25
    expect(result[0]).toBeCloseTo(25, 10);
  });
});
