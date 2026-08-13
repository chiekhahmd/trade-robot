export const KRAKEN_BASE_URL = 'https://api.kraken.com';

export const ENDPOINTS = {
  // Public (no auth)
  OHLC: '/0/public/OHLC',
  TICKER: '/0/public/Ticker',

  // Private (requires auth)
  BALANCE: '/0/private/Balance',
  ADD_ORDER: '/0/private/AddOrder',
  OPEN_ORDERS: '/0/private/OpenOrders',
  CLOSED_ORDERS: '/0/private/ClosedOrders',
} as const;

// Kraken uses internal pair names
export const PAIR_MAP: Record<string, string> = {
  'BTC/EUR': 'XXBTZEUR',
  'ETH/EUR': 'XETHZEUR',
};
