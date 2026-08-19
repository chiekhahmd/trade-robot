import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  checkStopLoss,
  checkTakeProfit,
  checkMaxDrawdown,
  calculateDrawdown,
} from '../../src/trading/risk-manager';
import { Position, RiskConfig } from '../../src/trading/types';

const defaultConfig: RiskConfig = {
  stopLossPct: 1.5,
  takeProfitPct: 3.0,
  maxRiskPerTradePct: 2.0,
  maxDrawdownPct: 10.0,
  minBalanceEUR: 10,
  leverage: 1,
};

describe('calculatePositionSize', () => {
  it('calculates size based on risk percentage', () => {
    const result = calculatePositionSize(60000, 1000, defaultConfig);
    // Stop loss at 60000 * (1 - 0.015) = 59100, loss per unit = 900
    // Max loss = 1000 * 0.02 = 20
    // Size = 20 / 900 ≈ 0.02222
    // But also capped at affordable: 1000 / 60000 ≈ 0.01667
    // So size should be min(0.02222, 0.01667) = 0.01667
    const maxAffordable = 1000 / 60000;
    expect(result.size).toBeCloseTo(maxAffordable, 4);
    expect(result.stopLossPrice).toBeCloseTo(59100, 0);
    expect(result.takeProfitPrice).toBeCloseTo(61800, 0);
  });

  it('caps size at affordable amount', () => {
    // Very small balance relative to price
    const result = calculatePositionSize(60000, 50, defaultConfig);
    const maxAffordable = 50 / 60000;
    expect(result.size).toBeLessThanOrEqual(maxAffordable);
  });

  it('returns 0 with reason when balance too low', () => {
    const result = calculatePositionSize(60000, 5, defaultConfig);
    expect(result.size).toBe(0);
    expect(result.reason).toBe('INSUFFICIENT_BALANCE');
  });

  it('stop loss price is below entry', () => {
    const result = calculatePositionSize(60000, 1000, defaultConfig);
    expect(result.stopLossPrice).toBeLessThan(60000);
  });

  it('take profit price is above entry', () => {
    const result = calculatePositionSize(60000, 1000, defaultConfig);
    expect(result.takeProfitPrice).toBeGreaterThan(60000);
  });

  it('leverage expands the affordability cap by the leverage factor', () => {
    // With risk% high enough that the affordability cap binds, leverage should
    // let us control a larger notional: cap = balance * leverage / price.
    const highRisk: RiskConfig = { ...defaultConfig, maxRiskPerTradePct: 100, leverage: 4 };
    const result = calculatePositionSize(60000, 1000, highRisk);
    const leveragedCap = (1000 * 4) / 60000;
    expect(result.size).toBeCloseTo(leveragedCap, 6);
  });

  it('4x leverage yields ~4x the size of spot when the cap binds', () => {
    const spot: RiskConfig = { ...defaultConfig, maxRiskPerTradePct: 100, leverage: 1 };
    const levered: RiskConfig = { ...defaultConfig, maxRiskPerTradePct: 100, leverage: 4 };
    const spotSize = calculatePositionSize(60000, 1000, spot).size;
    const leveredSize = calculatePositionSize(60000, 1000, levered).size;
    expect(leveredSize).toBeCloseTo(spotSize * 4, 6);
  });

  it('treats leverage of 0 or missing as spot (1x)', () => {
    const zeroLev: RiskConfig = { ...defaultConfig, maxRiskPerTradePct: 100, leverage: 0 };
    const result = calculatePositionSize(60000, 1000, zeroLev);
    const spotCap = 1000 / 60000;
    expect(result.size).toBeCloseTo(spotCap, 6);
  });
});

describe('checkStopLoss', () => {
  const position: Position = {
    pair: 'XXBTZEUR',
    side: 'buy',
    entryPrice: 60000,
    size: 0.01,
    stopLossPrice: 59100,
    takeProfitPrice: 61800,
    openedAt: Date.now(),
    orderId: 'test-order',
  };

  it('triggers when price at stop loss', () => {
    expect(checkStopLoss(position, 59100)).toBe(true);
  });

  it('triggers when price below stop loss', () => {
    expect(checkStopLoss(position, 58000)).toBe(true);
  });

  it('does not trigger when price above stop loss', () => {
    expect(checkStopLoss(position, 59500)).toBe(false);
  });
});

describe('checkTakeProfit', () => {
  const position: Position = {
    pair: 'XXBTZEUR',
    side: 'buy',
    entryPrice: 60000,
    size: 0.01,
    stopLossPrice: 59100,
    takeProfitPrice: 61800,
    openedAt: Date.now(),
    orderId: 'test-order',
  };

  it('triggers when price at take profit', () => {
    expect(checkTakeProfit(position, 61800)).toBe(true);
  });

  it('triggers when price above take profit', () => {
    expect(checkTakeProfit(position, 62000)).toBe(true);
  });

  it('does not trigger when price below take profit', () => {
    expect(checkTakeProfit(position, 61000)).toBe(false);
  });
});

describe('checkMaxDrawdown', () => {
  it('triggers at exactly max drawdown', () => {
    // 10% drawdown from peak of 1000 = current value 900
    expect(checkMaxDrawdown(1000, 900, 10)).toBe(true);
  });

  it('triggers when drawdown exceeds max', () => {
    expect(checkMaxDrawdown(1000, 850, 10)).toBe(true);
  });

  it('does not trigger below max drawdown', () => {
    expect(checkMaxDrawdown(1000, 950, 10)).toBe(false);
  });

  it('does not trigger with zero peak', () => {
    expect(checkMaxDrawdown(0, 0, 10)).toBe(false);
  });
});

describe('calculateDrawdown', () => {
  it('calculates correct percentage', () => {
    expect(calculateDrawdown(1000, 900)).toBeCloseTo(10, 5);
    expect(calculateDrawdown(1000, 950)).toBeCloseTo(5, 5);
    expect(calculateDrawdown(1000, 1000)).toBeCloseTo(0, 5);
  });

  it('returns 0 for zero peak', () => {
    expect(calculateDrawdown(0, 0)).toBe(0);
  });
});
