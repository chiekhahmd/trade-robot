/**
 * RSI (Relative Strength Index) calculation.
 *
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over N periods
 */

/**
 * Compute RSI values for an array of closing prices.
 * @param prices - Closing prices (chronological)
 * @param period - RSI period (typically 7 or 14)
 * @returns Array of RSI values (0-100). Length = prices.length - period
 */
export function computeRSI(prices: number[], period: number): number[] {
  if (prices.length < period + 1 || period < 1) return [];

  const rsiValues: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss from first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues.push(100 - 100 / (1 + rs));

  // Subsequent RSI values using smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs2));
  }

  return rsiValues;
}
