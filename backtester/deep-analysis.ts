/**
 * Deep Analysis — tests multiple pairs, strategies, capital levels.
 * Finds what actually worked in the last 3 months.
 *
 * Usage: npx tsx backtester/deep-analysis.ts
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { computeEMA } from '../src/strategy/ema';

const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function fetchCandles(pair: string, interval: number, months: number): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = now - months * 30 * 24 * 3600;

  const url = `${KRAKEN_OHLC_URL}?pair=${pair}&interval=${interval}&since=${startTimestamp}`;
  const response = await fetch(url);
  const data = (await response.json()) as { error: string[]; result: Record<string, unknown> };

  if (data.error?.length > 0) return [];

  const entries = data.result[pair] as KrakenOHLCEntry[] | undefined;
  if (!entries) return [];

  return entries.map(parseCandle).filter((c) => c.timestamp >= startTimestamp);
}

// ─── Strategy Implementations ────────────────────────────────────────────────

interface TradeResult {
  pnl: number;
  won: boolean;
}

interface StrategyResult {
  trades: TradeResult[];
  totalPnl: number;
  winRate: number;
  maxDrawdownPct: number;
}

// Strategy 1: EMA Crossover
function runEMACrossover(candles: Candle[], balance: number, leverage: number, config: {
  emaFast: number; emaSlow: number; slPct: number; tpPct: number; riskPct: number;
}): StrategyResult {
  const effectiveBalance = balance * leverage;
  const FEE_PCT = 0.26;
  const closes = candles.map((c) => c.close);
  const ema9 = computeEMA(closes, config.emaFast);
  const ema21 = computeEMA(closes, config.emaSlow);

  if (ema9.length < 2 || ema21.length < 2) return { trades: [], totalPnl: 0, winRate: 0, maxDrawdownPct: 0 };

  const trades: TradeResult[] = [];
  let equity = effectiveBalance;
  let peakEquity = equity;
  let maxDD = 0;
  let inPosition = false;
  let entryPrice = 0;
  let posSize = 0;
  let sl = 0;
  let tp = 0;

  // Align EMA arrays with candle indices
  const offset9 = closes.length - ema9.length;
  const offset21 = closes.length - ema21.length;
  const startIdx = Math.max(offset9, offset21) + 1;

  for (let i = startIdx; i < candles.length; i++) {
    const e9idx = i - offset9;
    const e21idx = i - offset21;
    if (e9idx < 1 || e21idx < 1) continue;

    const currE9 = ema9[e9idx];
    const prevE9 = ema9[e9idx - 1];
    const currE21 = ema21[e21idx];
    const prevE21 = ema21[e21idx - 1];
    const price = candles[i].close;
    const high = candles[i].high;
    const low = candles[i].low;

    if (inPosition) {
      // Check SL/TP
      if (low <= sl) {
        const pnl = (sl - entryPrice) * posSize - (sl * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: false });
        inPosition = false;
      } else if (high >= tp) {
        const pnl = (tp - entryPrice) * posSize - (tp * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: true });
        inPosition = false;
      } else if (currE9 < currE21 && prevE9 >= prevE21) {
        // SELL signal exit
        const pnl = (price - entryPrice) * posSize - (price * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: pnl > 0 });
        inPosition = false;
      }
    } else {
      // BUY signal
      if (currE9 > currE21 && prevE9 <= prevE21) {
        entryPrice = price;
        sl = price * (1 - config.slPct / 100);
        tp = price * (1 + config.tpPct / 100);
        const maxLoss = equity * (config.riskPct / 100);
        const lossPerUnit = entryPrice - sl;
        if (lossPerUnit > 0) {
          posSize = Math.min(maxLoss / lossPerUnit, equity / entryPrice);
          equity -= entryPrice * posSize * FEE_PCT / 100; // entry fee
          inPosition = true;
        }
      }
    }

    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  // Close remaining position
  if (inPosition) {
    const price = candles[candles.length - 1].close;
    const pnl = (price - entryPrice) * posSize - (price * posSize * FEE_PCT / 100);
    equity += pnl;
    trades.push({ pnl, won: pnl > 0 });
  }

  const totalPnl = equity - effectiveBalance;
  const wins = trades.filter((t) => t.won).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return { trades, totalPnl, winRate, maxDrawdownPct: maxDD };
}

// Strategy 2: RSI Mean Reversion
function computeRSI(prices: number[], period: number): number[] {
  if (prices.length < period + 1) return [];
  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs2));
  }

  return rsi;
}

function runRSIMeanReversion(candles: Candle[], balance: number, leverage: number, config: {
  rsiPeriod: number; oversold: number; overbought: number; slPct: number; tpPct: number; riskPct: number;
}): StrategyResult {
  const effectiveBalance = balance * leverage;
  const FEE_PCT = 0.26;
  const closes = candles.map((c) => c.close);
  const rsi = computeRSI(closes, config.rsiPeriod);

  if (rsi.length < 2) return { trades: [], totalPnl: 0, winRate: 0, maxDrawdownPct: 0 };

  const trades: TradeResult[] = [];
  let equity = effectiveBalance;
  let peakEquity = equity;
  let maxDD = 0;
  let inPosition = false;
  let entryPrice = 0;
  let posSize = 0;
  let sl = 0;
  let tp = 0;

  const rsiOffset = closes.length - rsi.length;

  for (let i = rsiOffset + 1; i < candles.length; i++) {
    const rsiIdx = i - rsiOffset;
    if (rsiIdx < 1) continue;

    const currRSI = rsi[rsiIdx];
    const prevRSI = rsi[rsiIdx - 1];
    const price = candles[i].close;
    const high = candles[i].high;
    const low = candles[i].low;

    if (inPosition) {
      if (low <= sl) {
        const pnl = (sl - entryPrice) * posSize - (sl * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: false });
        inPosition = false;
      } else if (high >= tp) {
        const pnl = (tp - entryPrice) * posSize - (tp * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: true });
        inPosition = false;
      } else if (currRSI >= config.overbought) {
        // Exit at overbought
        const pnl = (price - entryPrice) * posSize - (price * posSize * FEE_PCT / 100);
        equity += pnl;
        trades.push({ pnl, won: pnl > 0 });
        inPosition = false;
      }
    } else {
      // Buy when RSI crosses up from oversold
      if (currRSI > config.oversold && prevRSI <= config.oversold) {
        entryPrice = price;
        sl = price * (1 - config.slPct / 100);
        tp = price * (1 + config.tpPct / 100);
        const maxLoss = equity * (config.riskPct / 100);
        const lossPerUnit = entryPrice - sl;
        if (lossPerUnit > 0) {
          posSize = Math.min(maxLoss / lossPerUnit, equity / entryPrice);
          equity -= entryPrice * posSize * FEE_PCT / 100;
          inPosition = true;
        }
      }
    }

    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  if (inPosition) {
    const price = candles[candles.length - 1].close;
    const pnl = (price - entryPrice) * posSize - (price * posSize * FEE_PCT / 100);
    equity += pnl;
    trades.push({ pnl, won: pnl > 0 });
  }

  const totalPnl = equity - effectiveBalance;
  const wins = trades.filter((t) => t.won).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return { trades, totalPnl, winRate, maxDrawdownPct: maxDD };
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface TestCase {
  pair: string;
  pairLabel: string;
  strategy: string;
  capital: number;
  leverage: number;
  result: StrategyResult;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              DEEP ANALYSIS — FINDING THE BEST SETUP                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const pairs = [
    { pair: 'XETHZEUR', label: 'ETH/EUR' },
    { pair: 'XXBTZEUR', label: 'BTC/EUR' },
    { pair: 'ZEURZUSD', label: 'EUR/USD' },
    { pair: 'XRPEUR', label: 'XRP/EUR' },
    { pair: 'SOLEUR', label: 'SOL/EUR' },
  ];

  const capitals = [100, 200, 500, 1000];
  const leverages = [1, 4];

  const allResults: TestCase[] = [];

  for (const { pair, label } of pairs) {
    process.stdout.write(`Fetching ${label} (4h candles, 3 months)...`);
    const candles = await fetchCandles(pair, 240, 3);
    console.log(` ${candles.length} candles`);

    if (candles.length < 30) {
      console.log(`  ⚠️ Not enough data for ${label}, skipping`);
      await sleep(1200);
      continue;
    }

    for (const capital of capitals) {
      for (const leverage of leverages) {
        // EMA Crossover variations
        const emaConfigs = [
          { emaFast: 9, emaSlow: 21, slPct: 2, tpPct: 4, riskPct: 5 },
          { emaFast: 5, emaSlow: 13, slPct: 1.5, tpPct: 3, riskPct: 8 },
          { emaFast: 9, emaSlow: 21, slPct: 3, tpPct: 6, riskPct: 10 },
        ];

        for (const cfg of emaConfigs) {
          const result = runEMACrossover(candles, capital, leverage, cfg);
          allResults.push({
            pair, pairLabel: label,
            strategy: `EMA(${cfg.emaFast}/${cfg.emaSlow}) SL=${cfg.slPct}% TP=${cfg.tpPct}%`,
            capital, leverage, result
          });
        }

        // RSI Mean Reversion variations
        const rsiConfigs = [
          { rsiPeriod: 14, oversold: 30, overbought: 70, slPct: 2, tpPct: 3, riskPct: 5 },
          { rsiPeriod: 14, oversold: 25, overbought: 75, slPct: 1.5, tpPct: 4, riskPct: 8 },
          { rsiPeriod: 7, oversold: 20, overbought: 80, slPct: 2, tpPct: 5, riskPct: 10 },
        ];

        for (const cfg of rsiConfigs) {
          const result = runRSIMeanReversion(candles, capital, leverage, cfg);
          allResults.push({
            pair, pairLabel: label,
            strategy: `RSI(${cfg.rsiPeriod}) OS=${cfg.oversold} OB=${cfg.overbought} SL=${cfg.slPct}%`,
            capital, leverage, result
          });
        }
      }
    }

    await sleep(1500); // Rate limit
  }

  // ─── Results ─────────────────────────────────────────────────────────────

  // Sort by P&L% on capital
  const profitable = allResults
    .filter((r) => r.result.trades.length > 0)
    .map((r) => ({
      ...r,
      pnlPct: (r.result.totalPnl / r.capital) * 100,
    }))
    .sort((a, b) => b.pnlPct - a.pnlPct);

  console.log('\n');
  console.log('══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  TOP 15 PROFITABLE COMBINATIONS (sorted by P&L % on capital)');
  console.log('══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(
    '#'.padEnd(4) +
    'Pair'.padEnd(10) +
    'Strategy'.padEnd(40) +
    'Capital'.padEnd(9) +
    'Lev'.padEnd(5) +
    'Trades'.padEnd(8) +
    'Win%'.padEnd(7) +
    'P&L €'.padEnd(10) +
    'P&L%'.padEnd(9) +
    'MaxDD%'
  );
  console.log('─'.repeat(105));

  const top = profitable.slice(0, 15);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const pnlStr = (r.result.totalPnl >= 0 ? '+' : '') + r.result.totalPnl.toFixed(2);
    const pnlPctStr = (r.pnlPct >= 0 ? '+' : '') + r.pnlPct.toFixed(1) + '%';
    const ddOnCapital = (r.result.maxDrawdownPct * r.leverage);
    console.log(
      (i + 1).toString().padEnd(4) +
      r.pairLabel.padEnd(10) +
      r.strategy.padEnd(40) +
      `€${r.capital}`.padEnd(9) +
      `${r.leverage}x`.padEnd(5) +
      r.result.trades.length.toString().padEnd(8) +
      r.result.winRate.toFixed(0).padEnd(7) +
      pnlStr.padEnd(10) +
      pnlPctStr.padEnd(9) +
      ddOnCapital.toFixed(1) + '%'
    );
  }
  console.log('─'.repeat(105));

  // Losing combinations
  const worstLosers = profitable.slice(-5).reverse();
  console.log('\n  WORST 5 (avoid these):');
  console.log('  ' + '─'.repeat(100));
  for (const r of worstLosers) {
    const pnlStr = r.result.totalPnl.toFixed(2);
    const pnlPctStr = r.pnlPct.toFixed(1) + '%';
    console.log(`  ${r.pairLabel.padEnd(10)} ${r.strategy.padEnd(40)} €${r.capital} ${r.leverage}x  P&L: ${pnlStr} (${pnlPctStr})`);
  }

  // Summary
  const totalTested = allResults.length;
  const profitableCount = allResults.filter((r) => r.result.totalPnl > 0).length;
  const zeroTrades = allResults.filter((r) => r.result.trades.length === 0).length;

  console.log('\n');
  console.log('══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`  Total configurations tested: ${totalTested}`);
  console.log(`  Profitable: ${profitableCount} (${(profitableCount / totalTested * 100).toFixed(0)}%)`);
  console.log(`  Unprofitable: ${totalTested - profitableCount - zeroTrades}`);
  console.log(`  No trades (market too quiet): ${zeroTrades}`);
  console.log('');

  if (top.length > 0 && top[0].pnlPct > 0) {
    const best = top[0];
    console.log('  ✅ BEST SETUP:');
    console.log(`     Pair: ${best.pairLabel}`);
    console.log(`     Strategy: ${best.strategy}`);
    console.log(`     Capital: €${best.capital} × ${best.leverage}x leverage`);
    console.log(`     Result: ${best.result.trades.length} trades, ${best.result.winRate.toFixed(0)}% win rate`);
    console.log(`     P&L: +€${best.result.totalPnl.toFixed(2)} (+${best.pnlPct.toFixed(1)}% on capital)`);
    console.log(`     Max Drawdown: ${(best.result.maxDrawdownPct * best.leverage).toFixed(1)}% on capital`);
  } else {
    console.log('  ❌ No profitable configuration found in the last 3 months.');
    console.log('     The market has been unfavorable for all tested strategies.');
  }
  console.log('');
}

main().catch(console.error);
