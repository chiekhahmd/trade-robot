export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface SignalResult {
  signal: Signal;
  pair: string;
  ema9: number;
  ema21: number;
  closePrice: number;
  timestamp: number;
}
