/**
 * Mixed (regime-adaptive) strategy.
 *
 * Detects the market regime from EMA structure, then applies the strategy that
 * fits that regime:
 *   - TREND  → trend-following: ride the trend, exit via trailing stop (winners run)
 *   - RANGE  → mean-reversion:  buy oversold RSI bounce, exit at fixed TP / stop
 *
 * This module is PURE (no I/O) so it can be unit-tested and reused by both the
 * live handler and the backtester.
 */
import { computeEMA } from './ema';
import { computeRSI } from './rsi';

export type Regime = 'TREND' | 'RANGE';
export type MixedAction = 'ENTER' | 'EXIT' | 'HOLD';

export interface MixedConfig {
  emaFast: number;      // fast EMA period (e.g. 21)
  emaSlow: number;      // slow EMA period (e.g. 55)
  emaTrend: number;     // long trend filter EMA (e.g. 100) used for regime
  rsiPeriod: number;    // RSI period (e.g. 14)
  rsiOversold: number;  // e.g. 35
  rsiOverbought: number;// e.g. 70
  trendSlopeLookback: number; // candles used to measure slow-EMA slope
}

export const DEFAULT_MIXED_CONFIG: MixedConfig = {
  emaFast: 21,
  emaSlow: 55,
  emaTrend: 100,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 70,
  trendSlopeLookback: 5,
};

export interface MixedState {
  inPosition: boolean;
}

export interface MixedSignal {
  action: MixedAction;
  regime: Regime;
  reason: string;
  emaFast: number;
  emaSlow: number;
  rsi: number;
}

/**
 * Classify the current market regime.
 * TREND when price is above the long trend EMA AND the slow EMA is rising
 * enough over the lookback; RANGE otherwise.
 */
export function detectRegime(closes: number[], cfg: MixedConfig): Regime {
  const trendEma = computeEMA(closes, cfg.emaTrend);
  const slowEma = computeEMA(closes, cfg.emaSlow);
  if (trendEma.length < 1 || slowEma.length <= cfg.trendSlopeLookback) return 'RANGE';

  const price = closes[closes.length - 1];
  const trend = trendEma[trendEma.length - 1];

  const slowNow = slowEma[slowEma.length - 1];
  const slowPrev = slowEma[slowEma.length - 1 - cfg.trendSlopeLookback];
  const slopePct = ((slowNow - slowPrev) / slowPrev) * 100;

  // Uptrend: price above long EMA and slow EMA rising (> 0.1% over lookback)
  if (price > trend && slopePct > 0.1) return 'TREND';
  return 'RANGE';
}

/**
 * Compute the mixed-strategy decision for the latest candle.
 *
 * @param closes  chronological close prices (latest last)
 * @param state   current position state
 */
export function decideMixed(
  closes: number[],
  state: MixedState,
  cfg: MixedConfig = DEFAULT_MIXED_CONFIG,
): MixedSignal {
  const emaFastArr = computeEMA(closes, cfg.emaFast);
  const emaSlowArr = computeEMA(closes, cfg.emaSlow);
  const rsiArr = computeRSI(closes, cfg.rsiPeriod);

  const emaFast = emaFastArr.length ? emaFastArr[emaFastArr.length - 1] : 0;
  const emaSlow = emaSlowArr.length ? emaSlowArr[emaSlowArr.length - 1] : 0;
  const rsi = rsiArr.length ? rsiArr[rsiArr.length - 1] : 50;
  const rsiPrev = rsiArr.length >= 2 ? rsiArr[rsiArr.length - 2] : 50;

  const regime = detectRegime(closes, cfg);
  const base = { regime, emaFast, emaSlow, rsi };

  if (emaFastArr.length < 2 || emaSlowArr.length < 2) {
    return { action: 'HOLD', reason: 'INSUFFICIENT_DATA', ...base };
  }

  if (regime === 'TREND') {
    // Trend-following: be long while fast EMA is above slow EMA.
    // Exits in trend mode are handled by the trailing stop in the executor,
    // so we only decide ENTER (stay in) vs HOLD here.
    if (!state.inPosition && emaFast > emaSlow) {
      return { action: 'ENTER', reason: 'TREND_EMA_LONG', ...base };
    }
    return { action: 'HOLD', reason: 'TREND_WAIT', ...base };
  }

  // RANGE regime: mean-reversion.
  if (!state.inPosition) {
    // Buy oversold bounce: RSI crosses up through oversold.
    if (rsiPrev <= cfg.rsiOversold && rsi > cfg.rsiOversold) {
      return { action: 'ENTER', reason: 'RANGE_RSI_BOUNCE', ...base };
    }
    return { action: 'HOLD', reason: 'RANGE_WAIT', ...base };
  }

  // Holding in range: exit when overbought (fixed TP/SL also applied by executor).
  if (rsi >= cfg.rsiOverbought) {
    return { action: 'EXIT', reason: 'RANGE_RSI_OVERBOUGHT', ...base };
  }
  return { action: 'HOLD', reason: 'RANGE_HOLD', ...base };
}
