/**
 * Risk Manager — position sizing, stop loss, take profit, drawdown protection.
 */
import { Position, RiskConfig, PositionSizeResult } from './types';

/**
 * Calculate position size based on risk parameters.
 * Ensures max loss per trade doesn't exceed riskPct of portfolio.
 */
export function calculatePositionSize(
  entryPrice: number,
  balance: number,
  config: RiskConfig,
): PositionSizeResult {
  const stopLossPrice = entryPrice * (1 - config.stopLossPct / 100);
  const takeProfitPrice = entryPrice * (1 + config.takeProfitPct / 100);

  // Check minimum balance
  if (balance < config.minBalanceEUR) {
    return { size: 0, stopLossPrice, takeProfitPrice, reason: 'INSUFFICIENT_BALANCE' };
  }

  // Max loss per trade = portfolio × risk%
  const maxLoss = balance * (config.maxRiskPerTradePct / 100);

  // Loss per unit = entry - stop loss
  const lossPerUnit = entryPrice - stopLossPrice;
  if (lossPerUnit <= 0) {
    return { size: 0, stopLossPrice, takeProfitPrice, reason: 'INVALID_STOP_LOSS' };
  }

  // Position size based on risk
  let size = maxLoss / lossPerUnit;

  // Cap at what we can afford
  const maxAffordable = balance / entryPrice;
  if (size > maxAffordable) {
    size = maxAffordable;
  }

  return { size, stopLossPrice, takeProfitPrice };
}

/**
 * Check if stop loss should trigger.
 * Triggers when current price falls to or below the stop loss price.
 */
export function checkStopLoss(position: Position, currentPrice: number): boolean {
  return currentPrice <= position.stopLossPrice;
}

/**
 * Check if take profit should trigger.
 * Triggers when current price reaches or exceeds the take profit price.
 */
export function checkTakeProfit(position: Position, currentPrice: number): boolean {
  return currentPrice >= position.takeProfitPrice;
}

/**
 * Check if max drawdown has been reached.
 * Returns true if trading should be disabled.
 */
export function checkMaxDrawdown(
  peakValue: number,
  currentValue: number,
  maxDrawdownPct: number,
): boolean {
  if (peakValue <= 0) return false;
  const drawdownPct = ((peakValue - currentValue) / peakValue) * 100;
  return drawdownPct >= maxDrawdownPct;
}

/**
 * Calculate drawdown percentage.
 */
export function calculateDrawdown(peakValue: number, currentValue: number): number {
  if (peakValue <= 0) return 0;
  return ((peakValue - currentValue) / peakValue) * 100;
}
