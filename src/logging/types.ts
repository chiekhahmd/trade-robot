export interface SignalLog {
  pair: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  ema9: number;
  ema21: number;
  closePrice: number;
  cycleId: string;
  timestamp: number;
}

export interface TradeLog {
  pair: string;
  side: 'buy' | 'sell';
  size: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  fees: number;
  reason: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT';
  orderId: string;
  mode: 'LIVE' | 'PAPER';
  timestamp: number;
}

export interface SnapshotLog {
  totalEquity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openPositionsCount: number;
  peakEquity: number;
  drawdownPct: number;
  timestamp: number;
}
