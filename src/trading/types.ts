export interface Position {
  pair: string;
  side: 'buy';
  entryPrice: number;
  size: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  openedAt: number; // Unix timestamp
  orderId: string;
}

export interface RiskConfig {
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  maxDrawdownPct: number;
  minBalanceEUR: number;
}

export interface PositionSizeResult {
  size: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reason?: string; // set if trade skipped
}

export interface OrderParams {
  pair: string;
  side: 'buy' | 'sell';
  size: number;
  currentPrice: number;
  mode: 'LIVE' | 'PAPER';
}

export interface OrderResult {
  orderId: string;
  pair: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  timestamp: number;
  mode: 'LIVE' | 'PAPER';
}
