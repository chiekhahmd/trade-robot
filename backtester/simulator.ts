/**
 * Backtester Simulator — runs the EMA crossover strategy against historical candles.
 */
import { Candle } from '../src/kraken/types';
import { computeEMA } from '../src/strategy/ema';
import { detectCrossover } from '../src/strategy/signals';
import { calculatePositionSize } from '../src/trading/risk-manager';
import { RiskConfig } from '../src/trading/types';
import { TradeRecord } from './report';

interface OpenPosition {
  entryPrice: number;
  size: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  openedAt: number;
  feePaid: number;
}

export interface SimConfig {
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  emaFast: number;
  emaSlow: number;
}

export interface SimulationResult {
  trades: TradeRecord[];
  portfolioValues: number[];
  endingBalance: number;
}

const DEFAULT_CONFIG: SimConfig = {
  stopLossPct: 1.5,
  takeProfitPct: 3.0,
  maxRiskPerTradePct: 2.0,
  emaFast: 9,
  emaSlow: 21,
};

const FEE_PCT = 0.26; // Kraken taker fee

/**
 * Run the backtest simulation on historical candles.
 */
export function simulate(
  candles: Candle[],
  startingBalance: number,
  pair: string,
  config?: Partial<SimConfig>,
): SimulationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const riskConfig: RiskConfig = {
    stopLossPct: cfg.stopLossPct,
    takeProfitPct: cfg.takeProfitPct,
    maxRiskPerTradePct: cfg.maxRiskPerTradePct,
    maxDrawdownPct: 25,
    minBalanceEUR: 5,
  };

  const EMA_FAST = cfg.emaFast;
  const EMA_SLOW = cfg.emaSlow;

  let balance = startingBalance;
  let position: OpenPosition | null = null;
  const trades: TradeRecord[] = [];
  const portfolioValues: number[] = [];

  // We need at least EMA_SLOW + 1 candles to compute crossover
  const minCandles = EMA_SLOW + 1;
  if (candles.length < minCandles) {
    return { trades: [], portfolioValues: [startingBalance], endingBalance: startingBalance };
  }

  for (let i = minCandles; i < candles.length; i++) {
    const candle = candles[i];
    const closePrices = candles.slice(0, i + 1).map((c) => c.close);

    // Record portfolio value (balance + position market value)
    const positionValue = position ? position.size * candle.close : 0;
    portfolioValues.push(balance + positionValue);

    // If we have an open position, check SL/TP using candle high/low
    if (position) {
      let exitPrice: number | null = null;
      let reason: TradeRecord['reason'] | null = null;

      if (candle.low <= position.stopLossPrice) {
        exitPrice = position.stopLossPrice;
        reason = 'STOP_LOSS';
      } else if (candle.high >= position.takeProfitPrice) {
        exitPrice = position.takeProfitPrice;
        reason = 'TAKE_PROFIT';
      }

      if (exitPrice !== null && reason !== null) {
        const exitFee = exitPrice * position.size * (FEE_PCT / 100);
        const grossPnl = (exitPrice - position.entryPrice) * position.size;
        const pnl = grossPnl - position.feePaid - exitFee;
        balance += exitPrice * position.size - exitFee;

        const durationHours =
          (candle.timestamp - position.openedAt) / 3600;

        trades.push({
          entryDate: formatDate(position.openedAt),
          exitDate: formatDate(candle.timestamp),
          entryPrice: position.entryPrice,
          exitPrice,
          size: position.size,
          pnl,
          reason,
          durationHours,
        });

        position = null;
        continue;
      }

      // Check for SELL signal to exit
      const ema9 = computeEMA(closePrices, EMA_FAST);
      const ema21 = computeEMA(closePrices, EMA_SLOW);
      const signal = detectCrossover(ema9, ema21, pair, candle.close, candle.timestamp);

      if (signal.signal === 'SELL') {
        const exitPrice2 = candle.close;
        const exitFee = exitPrice2 * position.size * (FEE_PCT / 100);
        const grossPnl = (exitPrice2 - position.entryPrice) * position.size;
        const pnl = grossPnl - position.feePaid - exitFee;
        balance += exitPrice2 * position.size - exitFee;

        const durationHours =
          (candle.timestamp - position.openedAt) / 3600;

        trades.push({
          entryDate: formatDate(position.openedAt),
          exitDate: formatDate(candle.timestamp),
          entryPrice: position.entryPrice,
          exitPrice: exitPrice2,
          size: position.size,
          pnl,
          reason: 'SIGNAL_EXIT',
          durationHours,
        });

        position = null;
      }

      continue;
    }

    // No open position — look for BUY signal
    const ema9 = computeEMA(closePrices, EMA_FAST);
    const ema21 = computeEMA(closePrices, EMA_SLOW);
    const signal = detectCrossover(ema9, ema21, pair, candle.close, candle.timestamp);

    if (signal.signal === 'BUY') {
      const entryPrice = candle.close;
      // Account for fees when calculating available balance for position sizing
      const effectiveBalance = balance / (1 + FEE_PCT / 100);
      const sizing = calculatePositionSize(entryPrice, effectiveBalance, riskConfig);

      if (sizing.size > 0) {
        const entryFee = entryPrice * sizing.size * (FEE_PCT / 100);
        const cost = entryPrice * sizing.size + entryFee;

        if (cost <= balance) {
          balance -= cost;
          position = {
            entryPrice,
            size: sizing.size,
            stopLossPrice: sizing.stopLossPrice,
            takeProfitPrice: sizing.takeProfitPrice,
            openedAt: candle.timestamp,
            feePaid: entryFee,
          };
        }
      }
    }
  }

  // Close any remaining position at the last candle
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const exitFee = exitPrice * position.size * (FEE_PCT / 100);
    const grossPnl = (exitPrice - position.entryPrice) * position.size;
    const pnl = grossPnl - position.feePaid - exitFee;
    balance += exitPrice * position.size - exitFee;

    const durationHours =
      (lastCandle.timestamp - position.openedAt) / 3600;

    trades.push({
      entryDate: formatDate(position.openedAt),
      exitDate: formatDate(lastCandle.timestamp),
      entryPrice: position.entryPrice,
      exitPrice,
      size: position.size,
      pnl,
      reason: 'END_OF_DATA',
      durationHours,
    });

    position = null;
  }

  // Final portfolio value
  portfolioValues.push(balance);

  return { trades, portfolioValues, endingBalance: balance };
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
