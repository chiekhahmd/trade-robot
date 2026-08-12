import { Signal, SignalResult } from './types';

/**
 * Detect EMA crossover signal.
 *
 * BUY:  EMA9 crosses above EMA21 (current EMA9 > EMA21, previous EMA9 <= EMA21)
 * SELL: EMA9 crosses below EMA21 (current EMA9 < EMA21, previous EMA9 >= EMA21)
 * HOLD: No crossover detected
 */
export function detectCrossover(
  ema9Values: number[],
  ema21Values: number[],
  pair: string,
  closePrice: number,
  timestamp: number,
): SignalResult {
  if (ema9Values.length < 2 || ema21Values.length < 2) {
    return { signal: 'HOLD', pair, ema9: 0, ema21: 0, closePrice, timestamp };
  }

  const currEma9 = ema9Values[ema9Values.length - 1];
  const prevEma9 = ema9Values[ema9Values.length - 2];
  const currEma21 = ema21Values[ema21Values.length - 1];
  const prevEma21 = ema21Values[ema21Values.length - 2];

  let signal: Signal = 'HOLD';

  if (currEma9 > currEma21 && prevEma9 <= prevEma21) {
    signal = 'BUY';
  } else if (currEma9 < currEma21 && prevEma9 >= prevEma21) {
    signal = 'SELL';
  }

  return {
    signal,
    pair,
    ema9: currEma9,
    ema21: currEma21,
    closePrice,
    timestamp,
  };
}
