/**
 * Kraken API Client — handles authentication, signing, and HTTP requests.
 *
 * Authentication:
 * - API-Key header: public key
 * - API-Sign header: HMAC-SHA512(path + SHA256(nonce + postData), base64_decode(privateKey))
 * - Nonce: strictly increasing integer (Date.now())
 */
import { createHmac, createHash } from 'crypto';
import { Candle, parseCandle, KrakenOHLCEntry } from './types';
import { KRAKEN_BASE_URL, ENDPOINTS } from './endpoints';

export class KrakenClient {
  private apiKey: string;
  private privateKey: string;
  private baseUrl: string;

  constructor(apiKey: string, privateKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.privateKey = privateKey;
    this.baseUrl = baseUrl || KRAKEN_BASE_URL;
  }

  /**
   * Generate API-Sign header value.
   */
  private sign(path: string, nonce: number, postData: string): string {
    // SHA256(nonce + postData)
    const sha256 = createHash('sha256')
      .update(nonce + postData)
      .digest();

    // HMAC-SHA512(path + sha256, base64_decode(privateKey))
    const hmac = createHmac('sha512', Buffer.from(this.privateKey, 'base64'))
      .update(Buffer.concat([Buffer.from(path), sha256]))
      .digest('base64');

    return hmac;
  }

  /**
   * Make a public (unauthenticated) GET request.
   */
  private async publicRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { error: string[]; result: T };
    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error.join(', ')}`);
    }

    return data.result;
  }

  /**
   * Make a private (authenticated) POST request.
   */
  private async privateRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const nonce = Date.now();
    const postData = new URLSearchParams({ nonce: nonce.toString(), ...params }).toString();

    const signature = this.sign(path, nonce, postData);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': this.apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postData,
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { error: string[]; result: T };
    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error.join(', ')}`);
    }

    return data.result;
  }

  /**
   * Fetch OHLC candles for a pair.
   * @param pair - Kraken pair name (e.g., 'XXBTZEUR')
   * @param interval - Candle interval in minutes (default 30)
   * @param since - Optional unix timestamp to fetch candles since
   */
  async getOHLC(pair: string, interval = 30, since?: number): Promise<Candle[]> {
    const params: Record<string, string> = { pair, interval: interval.toString() };
    if (since) params.since = since.toString();

    const result = await this.publicRequest<Record<string, unknown>>(ENDPOINTS.OHLC, params);

    // Result contains the pair data and a 'last' field
    const entries = result[pair] as KrakenOHLCEntry[] | undefined;
    if (!entries) {
      throw new Error(`No candle data returned for pair ${pair}`);
    }

    return entries.map(parseCandle);
  }

  /**
   * Get account balance.
   * Returns a map of asset → balance (e.g., { ZEUR: "50.00", XXBT: "0.001" })
   */
  async getBalance(): Promise<Record<string, number>> {
    const result = await this.privateRequest<Record<string, string>>(ENDPOINTS.BALANCE);

    const balances: Record<string, number> = {};
    for (const [asset, value] of Object.entries(result)) {
      balances[asset] = parseFloat(value);
    }
    return balances;
  }

  /**
   * Place a market order.
   * @returns Order transaction ID
   */
  async addOrder(params: {
    pair: string;
    type: 'buy' | 'sell';
    volume: string; // Amount in base currency
    leverage?: number; // Margin multiplier; omitted/1 = spot order
  }): Promise<string> {
    const orderParams: Record<string, string> = {
      pair: params.pair,
      type: params.type,
      ordertype: 'market',
      volume: params.volume,
    };

    // Only send leverage for margin orders (>1). Kraken treats absence as spot.
    if (params.leverage && params.leverage > 1) {
      orderParams.leverage = params.leverage.toString();
    }

    const result = await this.privateRequest<{ txid: string[] }>(ENDPOINTS.ADD_ORDER, orderParams);

    if (!result.txid || result.txid.length === 0) {
      throw new Error('No transaction ID returned from order');
    }

    return result.txid[0];
  }
}
