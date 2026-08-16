/**
 * Parameter optimizer — tests multiple configurations with leverage.
 * Usage: npx tsx backtester/optimize.ts
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { simulate, SimConfig } from './simulator';

const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';

async function fetchCandles(pair: string, months: number): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = now - months * 30 * 24 * 3600;
  const interval = 240; // 4h candles

  const url = `${KRAKEN_OHLC_URL}?pair=${pair}&interval=${interval}&since=${startTimestamp}`;
  const response = await fetch(url);
  const data = (await response.json()) as { error: string[]; result: Record<string, unknown> };

  if (data.error?.length > 0) throw new Error(data.error.join(', '));

  const entries = data.result[pair] as KrakenOHLCEntry[];
  return entries.map(parseCandle).filter((c) => c.timestamp >= startTimestamp);
}

async function main() {
  const pair = 'ZEURZUSD';
  const capital = 150;
  const leverage = 4;
  const effectiveBalance = capital * leverage; // €600 buying power

  console.log(`Fetching 3 months of EUR/USD candles...`);
  const candles = await fetchCandles(pair, 3);
  console.log(`Got ${candles.length} candles\n`);

  const configs: { label: string; config: Partial<SimConfig> }[] = [
    { label: 'Conservative (SL=1.5%, TP=3%, Risk=2%)', config: { stopLossPct: 1.5, takeProfitPct: 3.0, maxRiskPerTradePct: 2.0 } },
    { label: 'Moderate (SL=2%, TP=4%, Risk=5%)', config: { stopLossPct: 2.0, takeProfitPct: 4.0, maxRiskPerTradePct: 5.0 } },
    { label: 'Aggressive (SL=2.5%, TP=5%, Risk=8%)', config: { stopLossPct: 2.5, takeProfitPct: 5.0, maxRiskPerTradePct: 8.0 } },
    { label: 'Very Aggressive (SL=3%, TP=6%, Risk=10%)', config: { stopLossPct: 3.0, takeProfitPct: 6.0, maxRiskPerTradePct: 10.0 } },
    { label: 'Tight SL, Big TP (SL=0.5%, TP=2%, Risk=5%)', config: { stopLossPct: 0.5, takeProfitPct: 2.0, maxRiskPerTradePct: 5.0 } },
    { label: 'Fast EMA 5/13 (SL=1%, TP=2%, Risk=5%)', config: { stopLossPct: 1.0, takeProfitPct: 2.0, maxRiskPerTradePct: 5.0, emaFast: 5, emaSlow: 13 } },
    { label: 'Fast EMA 5/13 Aggressive (SL=1%, TP=3%, Risk=10%)', config: { stopLossPct: 1.0, takeProfitPct: 3.0, maxRiskPerTradePct: 10.0, emaFast: 5, emaSlow: 13 } },
  ];

  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(`  EUR/USD BACKTEST — €${capital} capital × ${leverage}x leverage = €${effectiveBalance} buying power`);
  console.log(`  Period: 3 months | Interval: 4h candles | Fees: 0.26%`);
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Config'.padEnd(50) + 'Trades'.padEnd(8) + 'Win%'.padEnd(7) + 'P&L €'.padEnd(10) + 'P&L%'.padEnd(9) + 'MaxDD%');
  console.log('─'.repeat(90));

  for (const { label, config } of configs) {
    const result = simulate(candles, effectiveBalance, pair, config);
    const totalPnl = result.endingBalance - effectiveBalance;
    // P&L% on actual capital (not leveraged amount)
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
    // Drawdown on actual capital is amplified
    const maxDDCapital = (maxDD * effectiveBalance) / capital;

    const pnlStr = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2);
    const pnlPctStr = (pnlPctOnCapital >= 0 ? '+' : '') + pnlPctOnCapital.toFixed(1) + '%';

    console.log(
      label.padEnd(50) +
      result.trades.length.toString().padEnd(8) +
      winRate.toFixed(0).padEnd(7) +
      pnlStr.padEnd(10) +
      pnlPctStr.padEnd(9) +
      maxDDCapital.toFixed(1) + '%'
    );
  }
  console.log('─'.repeat(90));
  console.log(`\n  Note: P&L% and MaxDD% are on your actual €${capital} capital (leverage amplifies both gains AND losses)`);
  console.log(`  ⚠️  A 25% drawdown means you'd temporarily lose €${(capital * 0.25).toFixed(0)} from your peak`);
  console.log('');
}

main().catch(console.error);
