/**
 * RSI Mean Reversion signal detection.
 *
 * BUY: RSI crosses up from oversold (prevRSI <= oversold, currRSI > oversold)
 * SELL: RSI reaches overbought level
 * HOLD: Neither condition met
 */
import { Signal, SignalResult } from './types';

export interface RSIConfig {
  period: number;
  oversold: number;   // e.g., 20 or 30
  overbought: number; // e.g., 70 or 80
}

/**
 * Detect RSI mean-reversion signal.
 */
export function detectRSISignal(
  rsiValues: number[],
  pair: string,
  closePrice: number,
  timestamp: number,
  config: RSIConfig,
): SignalResult {
  if (rsiValues.length < 2) {
    return { signal: 'HOLD', pair, ema9: 0, ema21: 0, closePrice, timestamp };
  }

  const currRSI = rsiValues[rsiValues.length - 1];
  const prevRSI = rsiValues[rsiValues.length - 2];

  let signal: Signal = 'HOLD';

  // BUY: RSI crosses up from oversold
  if (currRSI > config.oversold && prevRSI <= config.oversold) {
    signal = 'BUY';
  }
  // SELL: RSI reaches overbought
  else if (currRSI >= config.overbought) {
    signal = 'SELL';
  }

  return {
    signal,
    pair,
    ema9: currRSI,  // Reuse ema9 field for current RSI
    ema21: prevRSI, // Reuse ema21 field for previous RSI
    closePrice,
    timestamp,
  };
}
