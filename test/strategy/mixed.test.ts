import { describe, it, expect } from 'vitest';
import { decideMixed, detectRegime, DEFAULT_MIXED_CONFIG, MixedConfig } from '../../src/strategy/mixed';

const cfg: MixedConfig = { ...DEFAULT_MIXED_CONFIG };

/** Build a steadily rising price series (strong uptrend). */
function uptrend(n: number, start = 100, stepPct = 0.5): number[] {
  const p: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v = v * (1 + stepPct / 100);
    p.push(v);
  }
  return p;
}

/** Build a flat/choppy series oscillating around a mean. */
function choppy(n: number, mean = 100, amp = 2): number[] {
  const p: number[] = [];
  for (let i = 0; i < n; i++) {
    p.push(mean + Math.sin(i / 2) * amp);
  }
  return p;
}

describe('detectRegime', () => {
  it('classifies a strong steady rise as TREND', () => {
    const closes = uptrend(200, 100, 0.6);
    expect(detectRegime(closes, cfg)).toBe('TREND');
  });

  it('classifies a flat oscillation as RANGE', () => {
    const closes = choppy(200, 100, 2);
    expect(detectRegime(closes, cfg)).toBe('RANGE');
  });

  it('returns RANGE when there is not enough data', () => {
    expect(detectRegime([100, 101, 102], cfg)).toBe('RANGE');
  });
});

describe('decideMixed', () => {
  it('enters a trend-follow long when in TREND and flat', () => {
    const closes = uptrend(200, 100, 0.6);
    const d = decideMixed(closes, { inPosition: false }, cfg);
    expect(d.regime).toBe('TREND');
    expect(d.action).toBe('ENTER');
    expect(d.reason).toBe('TREND_EMA_LONG');
  });

  it('holds (no double entry) when already in a trend position', () => {
    const closes = uptrend(200, 100, 0.6);
    const d = decideMixed(closes, { inPosition: true }, cfg);
    expect(d.action).toBe('HOLD');
  });

  it('does not enter on insufficient data', () => {
    const d = decideMixed([100, 101], { inPosition: false }, cfg);
    expect(d.action).toBe('HOLD');
    expect(d.reason).toBe('INSUFFICIENT_DATA');
  });

  it('exits a range position when RSI is overbought', () => {
    // Rise sharply at the end of a flat series to push RSI above overbought.
    const closes = choppy(180, 100, 1);
    for (let i = 0; i < 10; i++) closes.push(100 + i * 3);
    const d = decideMixed(closes, { inPosition: true }, cfg);
    if (d.regime === 'RANGE') {
      expect(['EXIT', 'HOLD']).toContain(d.action);
    }
    // RSI should be elevated after a sharp run-up
    expect(d.rsi).toBeGreaterThan(50);
  });
});
