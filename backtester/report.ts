/**
 * Backtester Report — statistics calculation and pretty-printing.
 */

export interface TradeRecord {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_EXIT' | 'END_OF_DATA';
  durationHours: number;
}

export interface BacktestReport {
  pair: string;
  months: number;
  startingBalance: number;
  endingBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  pnlPct: number;
  maxDrawdownPct: number;
  avgTradeDurationHours: number;
  sharpeRatio: number;
  trades: TradeRecord[];
}

/**
 * Calculate Sharpe ratio (simplified: avg_return / std_return).
 */
function calcSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std < 1e-10) return 0;
  return avg / std;
}

/**
 * Build the report from trade records and portfolio history.
 */
export function buildReport(
  trades: TradeRecord[],
  portfolioValues: number[],
  startingBalance: number,
  endingBalance: number,
  pair: string,
  months: number,
): BacktestReport {
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl <= 0).length;
  const totalPnl = endingBalance - startingBalance;
  const pnlPct = (totalPnl / startingBalance) * 100;

  // Max drawdown from portfolio values
  let maxDrawdownPct = 0;
  let peak = portfolioValues[0] || startingBalance;
  for (const value of portfolioValues) {
    if (value > peak) peak = value;
    const dd = ((peak - value) / peak) * 100;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  // Average trade duration
  const avgTradeDurationHours =
    trades.length > 0 ? trades.reduce((s, t) => s + t.durationHours, 0) / trades.length : 0;

  // Sharpe ratio from per-trade returns
  const tradeReturns = trades.map((t) => t.pnl / (t.entryPrice * t.size));
  const sharpeRatio = calcSharpe(tradeReturns);

  return {
    pair,
    months,
    startingBalance,
    endingBalance,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate: trades.length > 0 ? (winningTrades / trades.length) * 100 : 0,
    totalPnl,
    pnlPct,
    maxDrawdownPct,
    avgTradeDurationHours,
    sharpeRatio,
    trades,
  };
}

/**
 * Print the backtest report to console.
 */
export function printReport(report: BacktestReport): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  BACKTEST REPORT');
  console.log('═'.repeat(60));
  console.log(`  Pair:              ${report.pair}`);
  console.log(`  Period:            ${report.months} months`);
  console.log(`  Starting Balance:  €${report.startingBalance.toFixed(2)}`);
  console.log(`  Ending Balance:    €${report.endingBalance.toFixed(2)}`);
  console.log('─'.repeat(60));
  console.log(`  Total Trades:      ${report.totalTrades}`);
  console.log(`  Winning Trades:    ${report.winningTrades}`);
  console.log(`  Losing Trades:     ${report.losingTrades}`);
  console.log(`  Win Rate:          ${report.winRate.toFixed(1)}%`);
  console.log('─'.repeat(60));
  console.log(`  Total P&L:         €${report.totalPnl.toFixed(2)} (${report.pnlPct >= 0 ? '+' : ''}${report.pnlPct.toFixed(2)}%)`);
  console.log(`  Max Drawdown:      ${report.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Sharpe Ratio:      ${report.sharpeRatio.toFixed(3)}`);
  console.log(`  Avg Duration:      ${report.avgTradeDurationHours.toFixed(1)} hours`);
  console.log('═'.repeat(60));

  if (report.trades.length > 0) {
    console.log('\n  TRADE LOG:');
    console.log('  ' + '─'.repeat(58));
    console.log(
      '  ' +
        'Entry Date'.padEnd(18) +
        'Exit Date'.padEnd(18) +
        'Entry €'.padEnd(10) +
        'Exit €'.padEnd(10) +
        'P&L €'.padEnd(10) +
        'Reason',
    );
    console.log('  ' + '─'.repeat(58));
    for (const t of report.trades) {
      const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
      console.log(
        '  ' +
          t.entryDate.padEnd(18) +
          t.exitDate.padEnd(18) +
          t.entryPrice.toFixed(2).padEnd(10) +
          t.exitPrice.toFixed(2).padEnd(10) +
          pnlStr.padEnd(10) +
          t.reason,
      );
    }
    console.log('  ' + '─'.repeat(58));
  }

  console.log('');
}
