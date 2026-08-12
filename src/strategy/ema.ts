/**
 * Compute Exponential Moving Average (EMA) over an array of prices.
 *
 * @param prices - Array of closing prices (chronological order)
 * @param period - EMA period (e.g., 9 or 21)
 * @returns Array of EMA values (length = prices.length - period + 1)
 */
export function computeEMA(prices: number[], period: number): number[] {
  if (prices.length < period || period < 1) return [];

  const k = 2 / (period + 1); // Smoothing factor
  const emaValues: number[] = [];

  // Seed: Simple Moving Average of first `period` prices
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  emaValues.push(sum / period);

  // Iterate: EMA = close × k + prevEMA × (1 - k)
  for (let i = period; i < prices.length; i++) {
    const ema = prices[i] * k + emaValues[emaValues.length - 1] * (1 - k);
    emaValues.push(ema);
  }

  return emaValues;
}
