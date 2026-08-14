/**
 * Backtester CLI — fetch historical candles from Kraken and simulate the EMA crossover strategy.
 *
 * Usage:
 *   npx tsx backtester/index.ts --pair XETHZEUR --months 3 --balance 50
 */
import { Candle, KrakenOHLCEntry, parseCandle } from '../src/kraken/types';
import { simulate } from './simulator';
import { buildReport, printReport } from './report';

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  pair: string;
  months: number;
  balance: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let pair = 'XETHZEUR';
  let months = 3;
  let balance = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pair' && args[i + 1]) {
      pair = args[i + 1];
      i++;
    } else if (args[i] === '--months' && args[i + 1]) {
      months = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--balance' && args[i + 1]) {
      balance = parseFloat(args[i + 1]);
      i++;
    }
  }

  return { pair, months, balance };
}

// ─── Kraken OHLC Fetcher ─────────────────────────────────────────────────────

const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';
const CANDLES_PER_REQUEST = 720;

/**
 * Determine the best interval to cover the requested months.
 * Kraken returns max 720 candles per request. We pick an interval that
 * covers the full period in a single request when 30-min is insufficient,
 * then refetch at 30-min granularity where possible.
 */
function pickInterval(months: number): { interval: number; label: string } {
  // 720 candles × interval_minutes / 60 / 24 = coverage days
  // 30 min → 15 days, 60 min → 30 days, 240 min → 120 days, 1440 min → 720 days
  const targetDays = months * 30;
  if (targetDays <= 15) return { interval: 30, label: '30min' };
  if (targetDays <= 30) return { interval: 60, label: '1h' };
  if (targetDays <= 120) return { interval: 240, label: '4h' };
  return { interval: 1440, label: '1d' };
}

async function fetchCandles(pair: string, months: number): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = now - months * 30 * 24 * 3600;

  const { interval } = pickInterval(months);
  const intervalLabel = interval === 30 ? '30min' : interval === 60 ? '1h' : interval === 240 ? '4h' : '1d';

  console.log(`Fetching candles for ${pair} (${months} months, ${intervalLabel} interval)...`);
  console.log(`  Note: Kraken returns max ${CANDLES_PER_REQUEST} candles per request.`);

  const allCandles: Candle[] = [];
  let since = startTimestamp;
  let page = 0;

  while (true) {
    page++;
    const url = `${KRAKEN_OHLC_URL}?pair=${pair}&interval=${interval}&since=${since}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      error: string[];
      result: Record<string, unknown>;
    };

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error.join(', ')}`);
    }

    const entries = data.result[pair] as KrakenOHLCEntry[] | undefined;
    if (!entries || entries.length === 0) {
      break;
    }

    const candles = entries.map(parseCandle);
    allCandles.push(...candles);

    const last = data.result['last'] as number | undefined;
    process.stdout.write(`  Page ${page}: fetched ${entries.length} candles (total: ${allCandles.length})\r`);

    // Stop if we got fewer than max (no more data) or if last timestamp hasn't advanced
    if (entries.length < CANDLES_PER_REQUEST || !last || last <= since) {
      break;
    }

    since = last;

    // Small delay to be nice to Kraken's rate limit
    await sleep(1200);
  }

  console.log(`\n  Total candles fetched: ${allCandles.length}`);

  // Filter to only candles within the desired range
  const filtered = allCandles.filter((c) => c.timestamp >= startTimestamp);
  const actualDays = filtered.length > 1
    ? (filtered[filtered.length - 1].timestamp - filtered[0].timestamp) / 86400
    : 0;
  console.log(`  Candles in range: ${filtered.length} (covering ${actualDays.toFixed(1)} days)`);

  if (actualDays < months * 30 * 0.8) {
    console.log(`  ⚠ Kraken limits OHLC data to ~720 candles. Actual coverage: ${actualDays.toFixed(0)} days.`);
  }

  return filtered;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { pair, months, balance } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          EMA CROSSOVER BACKTESTER                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Config: pair=${pair}, months=${months}, balance=€${balance}`);
  console.log(`  Strategy: EMA(9/21) crossover`);
  console.log(`  Risk: SL=1.5%, TP=3%, max risk/trade=2%`);
  console.log(`  Fees: 0.26% per trade (Kraken taker)\n`);

  // Fetch historical candles
  const candles = await fetchCandles(pair, months);

  if (candles.length < 22) {
    console.error('Not enough candles to run backtest (need at least 22 for EMA21).');
    process.exit(1);
  }

  // Run simulation
  console.log('\nRunning simulation...');
  const result = simulate(candles, balance, pair);

  // Build and print report
  const report = buildReport(
    result.trades,
    result.portfolioValues,
    balance,
    result.endingBalance,
    pair,
    months,
  );

  printReport(report);
}

main().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
