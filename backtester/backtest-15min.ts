/**
 * 15-min candle backtest — tests multiple pairs and strategies over ~7 days.
 * Usage: npx tsx backtester/backtest-15min.ts
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { computeEMA } from '../src/strategy/ema';
import { computeRSI } from '../src/strategy/rsi';

const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';
const FEE_PCT = 0.26;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCandles15min(pair: string): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 7 * 24 * 3600; // 7 days ago
  const url = `${KRAKEN_OHLC_URL}?pair=${pair}&interval=15&since=${since}`;
  const response = await fetch(url);
  const data = (await response.json()) as { error: string[]; result: Record<string, unknown> };
  if (data.error?.length > 0) return [];
  const entries = data.result[pair] as KrakenOHLCEntry[] | undefined;
  if (!entries) return [];
  return entries.map(parseCandle).filter((c) => c.timestamp >= since);
}

interface TradeResult { pnl: number; won: boolean; }
interface StratResult { trades: TradeResult[]; totalPnl: number; winRate: number; maxDD: number; }

function runRSI(candles: Candle[], balance: number, leverage: number, cfg: {
  period: number; oversold: number; overbought: number; slPct: number; tpPct: number; riskPct: number;
}): StratResult {
  const eff = balance * leverage;
  const closes = candles.map(c => c.close);
  const rsi = computeRSI(closes, cfg.period);
  if (rsi.length < 2) return { trades: [], totalPnl: 0, winRate: 0, maxDD: 0 };

  const trades: TradeResult[] = [];
  let equity = eff;
  let peak = equity;
  let maxDD = 0;
  let inPos = false, entry = 0, size = 0, sl = 0, tp = 0, fee = 0;
  const offset = closes.length - rsi.length;

  for (let i = offset + 1; i < candles.length; i++) {
    const ri = i - offset;
    if (ri < 1) continue;
    const curr = rsi[ri], prev = rsi[ri - 1];
    const price = candles[i].close, high = candles[i].high, low = candles[i].low;

    if (inPos) {
      if (low <= sl) {
        const pnl = (sl - entry) * size - fee - sl * size * FEE_PCT / 100;
        equity += pnl; trades.push({ pnl, won: false }); inPos = false;
      } else if (high >= tp) {
        const pnl = (tp - entry) * size - fee - tp * size * FEE_PCT / 100;
        equity += pnl; trades.push({ pnl, won: true }); inPos = false;
      } else if (curr >= cfg.overbought) {
        const pnl = (price - entry) * size - fee - price * size * FEE_PCT / 100;
        equity += pnl; trades.push({ pnl, won: pnl > 0 }); inPos = false;
      }
    } else {
      if (curr > cfg.oversold && prev <= cfg.oversold) {
        entry = price;
        sl = price * (1 - cfg.slPct / 100);
        tp = price * (1 + cfg.tpPct / 100);
        const maxLoss = equity * (cfg.riskPct / 100);
        const lpu = entry - sl;
        if (lpu > 0) {
          size = Math.min(maxLoss / lpu, equity / entry);
          fee = entry * size * FEE_PCT / 100;
          equity -= fee;
          inPos = true;
        }
      }
    }
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  if (inPos) {
    const p = candles[candles.length-1].close;
    const pnl = (p - entry) * size - fee - p * size * FEE_PCT / 100;
    equity += pnl; trades.push({ pnl, won: pnl > 0 });
  }

  const wins = trades.filter(t => t.won).length;
  return { trades, totalPnl: equity - eff, winRate: trades.length > 0 ? wins/trades.length*100 : 0, maxDD };
}

function runEMA(candles: Candle[], balance: number, leverage: number, cfg: {
  fast: number; slow: number; slPct: number; tpPct: number; riskPct: number;
}): StratResult {
  const eff = balance * leverage;
  const closes = candles.map(c => c.close);
  const ema9 = computeEMA(closes, cfg.fast);
  const ema21 = computeEMA(closes, cfg.slow);
  if (ema9.length < 2 || ema21.length < 2) return { trades: [], totalPnl: 0, winRate: 0, maxDD: 0 };

  const trades: TradeResult[] = [];
  let equity = eff;
  let peak = equity;
  let maxDD = 0;
  let inPos = false, entry = 0, size = 0, sl = 0, tp = 0, fee = 0;
  const off9 = closes.length - ema9.length;
  const off21 = closes.length - ema21.length;
  const start = Math.max(off9, off21) + 1;

  for (let i = start; i < candles.length; i++) {
    const e9i = i - off9, e21i = i - off21;
    if (e9i < 1 || e21i < 1) continue;
    const ce9 = ema9[e9i], pe9 = ema9[e9i-1], ce21 = ema21[e21i], pe21 = ema21[e21i-1];
    const price = candles[i].close, high = candles[i].high, low = candles[i].low;

    if (inPos) {
      if (low <= sl) {
        const pnl = (sl - entry) * size - fee - sl*size*FEE_PCT/100;
        equity += pnl; trades.push({pnl, won:false}); inPos = false;
      } else if (high >= tp) {
        const pnl = (tp - entry) * size - fee - tp*size*FEE_PCT/100;
        equity += pnl; trades.push({pnl, won:true}); inPos = false;
      } else if (ce9 < ce21 && pe9 >= pe21) {
        const pnl = (price - entry) * size - fee - price*size*FEE_PCT/100;
        equity += pnl; trades.push({pnl, won: pnl>0}); inPos = false;
      }
    } else {
      if (ce9 > ce21 && pe9 <= pe21) {
        entry = price; sl = price*(1-cfg.slPct/100); tp = price*(1+cfg.tpPct/100);
        const maxLoss = equity * (cfg.riskPct/100);
        const lpu = entry - sl;
        if (lpu > 0) {
          size = Math.min(maxLoss/lpu, equity/entry);
          fee = entry*size*FEE_PCT/100;
          equity -= fee; inPos = true;
        }
      }
    }
    if (equity > peak) peak = equity;
    const dd = (peak-equity)/peak*100;
    if (dd > maxDD) maxDD = dd;
  }
  if (inPos) {
    const p = candles[candles.length-1].close;
    const pnl = (p-entry)*size - fee - p*size*FEE_PCT/100;
    equity += pnl; trades.push({pnl, won: pnl>0});
  }
  const wins = trades.filter(t=>t.won).length;
  return { trades, totalPnl: equity-eff, winRate: trades.length>0 ? wins/trades.length*100 : 0, maxDD };
}

async function main() {
  const pairs = [
    { pair: 'SOLEUR', label: 'SOL/EUR' },
    { pair: 'XXBTZEUR', label: 'BTC/EUR' },
    { pair: 'XETHZEUR', label: 'ETH/EUR' },
    { pair: 'ZEURZUSD', label: 'EUR/USD' },
  ];

  const capital = 100;
  const leverage = 4;

  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log(`  15-MIN CANDLES BACKTEST — 7 DAYS — €${capital} × ${leverage}x = €${capital*leverage}`);
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Pair'.padEnd(10) + 'Strategy'.padEnd(38) + 'Trades'.padEnd(8) + 'Win%'.padEnd(7) + 'P&L €'.padEnd(10) + 'P&L%'.padEnd(9) + 'MaxDD%');
  console.log('─'.repeat(88));

  for (const { pair, label } of pairs) {
    process.stdout.write(`Fetching ${label}...`);
    const candles = await fetchCandles15min(pair);
    console.log(` ${candles.length} candles`);

    if (candles.length < 30) { console.log('  ⚠️ Not enough data'); await sleep(1500); continue; }

    const strategies: { name: string; fn: () => StratResult }[] = [
      { name: 'RSI(7) OS=20 OB=80 SL=2% TP=5%', fn: () => runRSI(candles, capital, leverage, { period:7, oversold:20, overbought:80, slPct:2, tpPct:5, riskPct:10 }) },
      { name: 'RSI(7) OS=25 OB=75 SL=1.5% TP=3%', fn: () => runRSI(candles, capital, leverage, { period:7, oversold:25, overbought:75, slPct:1.5, tpPct:3, riskPct:10 }) },
      { name: 'RSI(14) OS=30 OB=70 SL=2% TP=4%', fn: () => runRSI(candles, capital, leverage, { period:14, oversold:30, overbought:70, slPct:2, tpPct:4, riskPct:10 }) },
      { name: 'RSI(14) OS=35 OB=65 SL=1% TP=2%', fn: () => runRSI(candles, capital, leverage, { period:14, oversold:35, overbought:65, slPct:1, tpPct:2, riskPct:10 }) },
      { name: 'EMA(5/13) SL=1% TP=2%', fn: () => runEMA(candles, capital, leverage, { fast:5, slow:13, slPct:1, tpPct:2, riskPct:10 }) },
      { name: 'EMA(9/21) SL=2% TP=4%', fn: () => runEMA(candles, capital, leverage, { fast:9, slow:21, slPct:2, tpPct:4, riskPct:10 }) },
      { name: 'EMA(3/8) SL=0.5% TP=1%', fn: () => runEMA(candles, capital, leverage, { fast:3, slow:8, slPct:0.5, tpPct:1, riskPct:10 }) },
    ];

    for (const { name, fn } of strategies) {
      const r = fn();
      const pnlPct = (r.totalPnl / capital) * 100;
      const pnlStr = (r.totalPnl >= 0 ? '+' : '') + r.totalPnl.toFixed(2);
      const pctStr = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%';
      const ddCap = r.maxDD * leverage;
      console.log(
        label.padEnd(10) + name.padEnd(38) + r.trades.length.toString().padEnd(8) +
        r.winRate.toFixed(0).padEnd(7) + pnlStr.padEnd(10) + pctStr.padEnd(9) + ddCap.toFixed(1) + '%'
      );
    }
    console.log('');
    await sleep(1500);
  }
  console.log('─'.repeat(88));
}

main().catch(console.error);
