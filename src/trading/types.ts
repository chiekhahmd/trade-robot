export interface Position {
  pair: string;
  side: 'buy';
  entryPrice: number;
  size: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  openedAt: number; // Unix timestamp
  orderId: string;
  // Mixed-strategy fields (optional; present for MIXED positions)
  regime?: 'TREND' | 'RANGE';   // regime at entry — decides exit logic
  trailPct?: number;            // trailing-stop distance % (TREND positions)
  highWater?: number;           // highest price seen since entry (TREND positions)
}

export interface RiskConfig {
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  maxDrawdownPct: number;
  minBalanceEUR: number;
  leverage: number; // 1 = spot (no leverage), >1 = margin
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
