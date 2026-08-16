/**
 * EUR/USD backtest with 30-min candles (paginated), €150 × 4x leverage.
 * Usage: npx tsx backtester/optimize-30min.ts
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { simulate, SimConfig } from './simulator';

const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCandles30min(pair: string, months: number): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = now - months * 30 * 24 * 3600;
  const interval = 30; // 30-minute candles

  console.log(`Fetching ${months} months of 30-min candles for ${pair} (paginated)...`);

  const allCandles: Candle[] = [];
  let since = startTimestamp;
  let page = 0;

  while (true) {
    page++;
    const url = `${KRAKEN_OHLC_URL}?pair=${pair}&interval=${interval}&since=${since}`;
    const response = await fetch(url);
    const data = (await response.json()) as { error: string[]; result: Record<string, unknown> };

    if (data.error?.length > 0) throw new Error(data.error.join(', '));

    const entries = data.result[pair] as KrakenOHLCEntry[];
    if (!entries || entries.length === 0) break;

    const candles = entries.map(parseCandle);
    allCandles.push(...candles);

    const last = data.result['last'] as number | undefined;
    process.stdout.write(`  Page ${page}: +${entries.length} candles (total: ${allCandles.length})\r`);

    if (entries.length < 720 || !last || last <= since) break;
    since = last;

    // Rate limit: wait 1.5s between requests
    await sleep(1500);
  }

  const filtered = allCandles.filter((c) => c.timestamp >= startTimestamp);
  const days = filtered.length > 1 ? (filtered[filtered.length - 1].timestamp - filtered[0].timestamp) / 86400 : 0;
  console.log(`\n  Total: ${filtered.length} candles covering ${days.toFixed(1)} days\n`);

  return filtered;
}

async function main() {
  const pair = 'ZEURZUSD';
  const capital = 150;
  const leverage = 4;
  const effectiveBalance = capital * leverage;

  const candles = await fetchCandles30min(pair, 3);

  if (candles.length < 50) {
    console.error('Not enough candles. Got:', candles.length);
    process.exit(1);
  }

  const configs: { label: string; config: Partial<SimConfig> }[] = [
    { label: 'Conservative (SL=1.5%, TP=3%, Risk=2%)', config: { stopLossPct: 1.5, takeProfitPct: 3.0, maxRiskPerTradePct: 2.0 } },
    { label: 'Moderate (SL=1%, TP=2%, Risk=5%)', config: { stopLossPct: 1.0, takeProfitPct: 2.0, maxRiskPerTradePct: 5.0 } },
    { label: 'Aggressive (SL=0.5%, TP=1.5%, Risk=8%)', config: { stopLossPct: 0.5, takeProfitPct: 1.5, maxRiskPerTradePct: 8.0 } },
    { label: 'Scalp (SL=0.3%, TP=0.6%, Risk=10%)', config: { stopLossPct: 0.3, takeProfitPct: 0.6, maxRiskPerTradePct: 10.0 } },
    { label: 'EMA 9/21 Moderate', config: { stopLossPct: 0.5, takeProfitPct: 1.0, maxRiskPerTradePct: 5.0, emaFast: 9, emaSlow: 21 } },
    { label: 'EMA 5/13 Tight', config: { stopLossPct: 0.3, takeProfitPct: 0.8, maxRiskPerTradePct: 5.0, emaFast: 5, emaSlow: 13 } },
    { label: 'EMA 5/13 Aggressive', config: { stopLossPct: 0.5, takeProfitPct: 1.5, maxRiskPerTradePct: 10.0, emaFast: 5, emaSlow: 13 } },
    { label: 'EMA 3/8 Scalp', config: { stopLossPct: 0.2, takeProfitPct: 0.5, maxRiskPerTradePct: 8.0, emaFast: 3, emaSlow: 8 } },
  ];

  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log(`  EUR/USD — 30-MIN CANDLES — €${capital} × ${leverage}x = €${effectiveBalance} buying power`);
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Config'.padEnd(42) + 'Trades'.padEnd(8) + 'Win%'.padEnd(7) + 'P&L €'.padEnd(10) + 'P&L%'.padEnd(9) + 'MaxDD%');
  console.log('─'.repeat(82));

  for (const { label, config } of configs) {
    const result = simulate(candles, effectiveBalance, pair, config);
    const totalPnl = result.endingBalance - effectiveBalance;
    const pnlPctOnCapital = (totalPnl / capital) * 100;
    const wins = result.trades.filter((t: {pnl: number}) => t.pnl > 0).length;
    const winRate = result.trades.length > 0 ? (wins / result.trades.length) * 100 : 0;

    let maxDD = 0;
    let peak = result.portfolioValues[0] || effectiveBalance;
    for (const v of result.portfolioValues) {
      if (v > peak) peak = v;
      const dd = ((peak - v) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
    const maxDDCapital = (maxDD * effectiveBalance) / capital;

    const pnlStr = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2);
    const pnlPctStr = (pnlPctOnCapital >= 0 ? '+' : '') + pnlPctOnCapital.toFixed(1) + '%';

    console.log(
      label.padEnd(42) +
      result.trades.length.toString().padEnd(8) +
      winRate.toFixed(0).padEnd(7) +
      pnlStr.padEnd(10) +
      pnlPctStr.padEnd(9) +
      maxDDCapital.toFixed(1) + '%'
    );
  }
  console.log('─'.repeat(82));
  console.log(`\n  P&L% and MaxDD% are on your actual €${capital} capital`);
  console.log('');
}

main().catch(console.error);
