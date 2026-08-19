/**
 * Mixed-strategy backtest across multiple timeframes vs. buy-and-hold.
 *
 * Fetches historical candles from Kraken's public API (paginated) and simulates:
 *   - the regime-adaptive mixed strategy (trend-follow + mean-revert)
 *   - a buy-and-hold baseline
 *
 * Run: npx tsx backtester/mixed-backtest.ts
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { decideMixed, detectRegime, DEFAULT_MIXED_CONFIG, MixedConfig } from '../src/strategy/mixed';

const KRAKEN_URL = 'https://api.kraken.com/0/public/OHLC';
const FEE_PCT = 0.26; // Kraken taker fee, each side

const PAIRS = ['SOLEUR', 'XXBTZEUR', 'XETHZEUR'];
// interval (minutes) → how many days of history to pull
const TIMEFRAMES = [15, 30, 60, 240];
const DAYS = 90;

interface SimResult {
  trades: number;
  wins: number;
  pnlPct: number;      // return on starting capital (margin), %
  maxDDPct: number;
  finalEquity: number;
}

async function fetchCandles(pair: string, interval: number, days: number): Promise<Candle[]> {
  const startSince = Math.floor(Date.now() / 1000) - days * 86400;
  let since = startSince;
  const all: Candle[] = [];
  // Kraken returns up to 720 candles per call; paginate with `last`.
  for (let page = 0; page < 30; page++) {
    const r = await fetch(`${KRAKEN_URL}?pair=${pair}&interval=${interval}&since=${since}`);
    const d = (await r.json()) as any;
    if (d.error?.length) break;
    const entries = d.result?.[pair] as KrakenOHLCEntry[] | undefined;
    if (!entries || entries.length === 0) break;
    const candles = entries.map(parseCandle);
    // Avoid duplicating the boundary candle
    for (const c of candles) {
      if (all.length === 0 || c.timestamp > all[all.length - 1].timestamp) all.push(c);
    }
    const last = Number(d.result.last);
    if (!last || last <= since) break;
    since = last;
    if (candles.length < 720) break; // no more pages
    await new Promise((res) => setTimeout(res, 900)); // be gentle on rate limits
  }
  return all.filter((c) => c.timestamp >= startSince);
}

/**
 * Simulate the mixed strategy.
 * - TREND regime: enter long on EMA structure, exit via trailing stop.
 * - RANGE regime: enter on RSI bounce, exit on overbought / fixed SL / fixed TP.
 */
function simulateMixed(
  candles: Candle[],
  startCapital: number,
  leverage: number,
  cfg: MixedConfig,
  opts: { trailPct: number; rangeSlPct: number; rangeTpPct: number; riskPct: number },
): SimResult {
  const warmup = Math.max(cfg.emaTrend, cfg.emaSlow) + cfg.trendSlopeLookback + 2;
  if (candles.length < warmup + 2) {
    return { trades: 0, wins: 0, pnlPct: 0, maxDDPct: 0, finalEquity: startCapital };
  }

  let equity = startCapital;      // real capital (margin)
  let peak = startCapital;
  let maxDD = 0;
  let trades = 0;
  let wins = 0;

  let inPos = false;
  let entry = 0;
  let size = 0;         // units of base asset controlled
  let sl = 0;           // hard stop (range) or trailing stop (trend)
  let tp = 0;           // take profit (range only; Infinity in trend)
  let entryRegime: 'TREND' | 'RANGE' = 'RANGE';
  let highWater = 0;    // highest price seen while in a trend position

  const closeTrade = (exitPrice: number) => {
    // PnL on the leveraged notional, fees on both legs of the notional.
    const gross = (exitPrice - entry) * size;
    const fees = (entry * size + exitPrice * size) * (FEE_PCT / 100);
    const pnl = gross - fees;
    equity += pnl;
    trades++;
    if (pnl > 0) wins++;
    inPos = false;
  };

  for (let i = warmup; i < candles.length; i++) {
    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const c = candles[i];
    const price = c.close;

    if (inPos) {
      if (entryRegime === 'TREND') {
        // Update trailing stop from the running high.
        if (c.high > highWater) highWater = c.high;
        const trail = highWater * (1 - opts.trailPct / 100);
        if (trail > sl) sl = trail;
        // Exit if low pierces the trailing stop.
        if (c.low <= sl) {
          closeTrade(sl);
          continue;
        }
      } else {
        // RANGE: fixed stop / take-profit first.
        if (c.low <= sl) { closeTrade(sl); continue; }
        if (c.high >= tp) { closeTrade(tp); continue; }
        // Then signal-based exit (overbought).
        const sig = decideMixed(closes, { inPosition: true }, cfg);
        if (sig.action === 'EXIT') { closeTrade(price); continue; }
      }
    } else {
      const sig = decideMixed(closes, { inPosition: false }, cfg);
      if (sig.action === 'ENTER') {
        entry = price;
        entryRegime = sig.regime;
        // Position sizing: risk `riskPct` of equity against the stop distance,
        // capped by leveraged buying power.
        const stopDistPct = entryRegime === 'TREND' ? opts.trailPct : opts.rangeSlPct;
        const maxLoss = equity * (opts.riskPct / 100);
        const lossPerUnit = entry * (stopDistPct / 100);
        let s = lossPerUnit > 0 ? maxLoss / lossPerUnit : 0;
        const maxAffordable = (equity * leverage) / entry;
        if (s > maxAffordable) s = maxAffordable;
        if (s <= 0) continue;
        size = s;
        if (entryRegime === 'TREND') {
          highWater = c.high;
          sl = entry * (1 - opts.trailPct / 100);
          tp = Infinity;
        } else {
          sl = entry * (1 - opts.rangeSlPct / 100);
          tp = entry * (1 + opts.rangeTpPct / 100);
        }
        inPos = true;
      }
    }

    // Track drawdown on marked-to-market equity.
    const marked = inPos ? equity + (price - entry) * size : equity;
    if (marked > peak) peak = marked;
    const dd = ((peak - marked) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  if (inPos) closeTrade(candles[candles.length - 1].close);

  return {
    trades,
    wins,
    pnlPct: ((equity - startCapital) / startCapital) * 100,
    maxDDPct: maxDD,
    finalEquity: equity,
  };
}

function buyHoldPct(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  return ((last - first) / first) * 100;
}

function regimeMix(candles: Candle[], cfg: MixedConfig): { trendPct: number } {
  const warmup = Math.max(cfg.emaTrend, cfg.emaSlow) + cfg.trendSlopeLookback + 2;
  let trend = 0;
  let total = 0;
  for (let i = warmup; i < candles.length; i++) {
    const closes = candles.slice(0, i + 1).map((c) => c.close);
    if (detectRegime(closes, cfg) === 'TREND') trend++;
    total++;
  }
  return { trendPct: total ? (trend / total) * 100 : 0 };
}

async function main() {
  const START = 50;      // €50 real capital
  const LEVERAGE = 4;
  const cfg = DEFAULT_MIXED_CONFIG;
  const opts = { trailPct: 4, rangeSlPct: 2, rangeTpPct: 4, riskPct: 10 };

  console.log(`MIXED STRATEGY BACKTEST — ${DAYS} days — €${START} × ${LEVERAGE}x leverage`);
  console.log(`Trend: EMA${cfg.emaFast}/${cfg.emaSlow} + EMA${cfg.emaTrend} filter, trailing ${opts.trailPct}%`);
  console.log(`Range: RSI(${cfg.rsiPeriod}) ${cfg.rsiOversold}/${cfg.rsiOverbought}, SL ${opts.rangeSlPct}% TP ${opts.rangeTpPct}%`);
  console.log('='.repeat(96));
  console.log(
    'Pair'.padEnd(10) + 'TF'.padEnd(6) + 'Trades'.padEnd(8) + 'Win%'.padEnd(7) +
    'Trend%'.padEnd(8) + 'Strat%'.padEnd(9) + 'Buy&Hold%'.padEnd(11) + 'MaxDD%'.padEnd(8) + 'Edge',
  );
  console.log('-'.repeat(96));

  for (const pair of PAIRS) {
    for (const tf of TIMEFRAMES) {
      const candles = await fetchCandles(pair, tf, DAYS);
      const label = pair === 'SOLEUR' ? 'SOL/EUR' : pair === 'XXBTZEUR' ? 'BTC/EUR' : 'ETH/EUR';
      if (candles.length < 120) {
        console.log(label.padEnd(10) + `${tf}m`.padEnd(6) + 'NOT ENOUGH DATA (' + candles.length + ')');
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      const res = simulateMixed(candles, START, LEVERAGE, cfg, opts);
      const bh = buyHoldPct(candles);
      const { trendPct } = regimeMix(candles, cfg);
      const wr = res.trades > 0 ? ((res.wins / res.trades) * 100).toFixed(0) : '—';
      const edge = res.pnlPct - bh;
      const edgeStr = (edge >= 0 ? '+' : '') + edge.toFixed(1);
      console.log(
        label.padEnd(10) +
        `${tf}m`.padEnd(6) +
        res.trades.toString().padEnd(8) +
        wr.padEnd(7) +
        trendPct.toFixed(0).padEnd(8) +
        ((res.pnlPct >= 0 ? '+' : '') + res.pnlPct.toFixed(1)).padEnd(9) +
        ((bh >= 0 ? '+' : '') + bh.toFixed(1)).padEnd(11) +
        res.maxDDPct.toFixed(1).padEnd(8) +
        edgeStr,
      );
      await new Promise((r) => setTimeout(r, 900));
    }
    console.log('-'.repeat(96));
  }

  console.log('\nStrat%   = mixed strategy return on €50 margin (leveraged)');
  console.log('Buy&Hold%= holding the asset over the same window (unleveraged spot)');
  console.log('Edge     = Strat% minus Buy&Hold% (positive = strategy beat holding)');
}

main().catch(console.error);
