export interface Candle {
  timestamp: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Kraken returns OHLC as: [timestamp, open, high, low, close, vwap, volume, count]
export type KrakenOHLCEntry = [number, string, string, string, string, string, string, number];

export interface KrakenOHLCResponse {
  error: string[];
  result: Record<string, KrakenOHLCEntry[] | number>;
}

export interface KrakenBalanceResponse {
  error: string[];
  result: Record<string, string>;
}

export interface KrakenOrderResponse {
  error: string[];
  result: {
    descr: { order: string };
    txid: string[];
  };
}

/**
 * Parse a Kraken OHLC array entry into a Candle object.
 */
export function parseCandle(entry: KrakenOHLCEntry): Candle {
  return {
    timestamp: entry[0],
    open: parseFloat(entry[1]),
    high: parseFloat(entry[2]),
    low: parseFloat(entry[3]),
    close: parseFloat(entry[4]),
    volume: parseFloat(entry[6]),
  };
}
