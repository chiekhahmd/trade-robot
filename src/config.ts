/**
 * Configuration loader — reads bot config from DynamoDB.
 */
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface BotConfig {
  enabled: boolean;
  mode: 'PAPER' | 'LIVE';
  pairs: PairConfig[];
  maxDrawdownPct: number;
  minBalanceEUR: number;
}

export interface PairConfig {
  pair: string;           // Kraken pair name (e.g., 'SOLEUR', 'XXBTZEUR')
  strategy: 'EMA_CROSSOVER' | 'RSI_MEAN_REVERSION' | 'MIXED';
  // EMA params (used when strategy = EMA_CROSSOVER)
  emaFastPeriod: number;
  emaSlowPeriod: number;
  // RSI params (used when strategy = RSI_MEAN_REVERSION / MIXED range mode)
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  // MIXED params (regime-adaptive trend-follow + mean-revert)
  emaTrendPeriod: number;   // long trend filter EMA (regime detection)
  trailPct: number;         // trailing-stop distance % (TREND positions)
  // Risk params (per pair)
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  leverage: number;
}

const DEFAULT_PAIR_CONFIG: PairConfig = {
  pair: 'SOLEUR',
  strategy: 'MIXED',
  // Trend-follow structure (matches backtested 15m mixed strategy)
  emaFastPeriod: 21,
  emaSlowPeriod: 55,
  emaTrendPeriod: 100,
  trailPct: 4.0,
  // Range mean-reversion params
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 70,
  stopLossPct: 2.0,
  takeProfitPct: 4.0,
  maxRiskPerTradePct: 10.0,
  leverage: 4,
};

const DEFAULTS: BotConfig = {
  enabled: true,
  mode: 'PAPER',
  pairs: [
    { ...DEFAULT_PAIR_CONFIG, pair: 'SOLEUR' },
    { ...DEFAULT_PAIR_CONFIG, pair: 'XXBTZEUR' },
    { ...DEFAULT_PAIR_CONFIG, pair: 'XETHZEUR' },
  ],
  maxDrawdownPct: 15.0,
  minBalanceEUR: 10,
};

export async function loadConfig(
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<BotConfig> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: 'CONFIG', SK: 'PARAMS' },
    }),
  );

  const item = result.Item || {};

  const config: BotConfig = {
    enabled: typeof item.enabled === 'boolean' ? item.enabled : DEFAULTS.enabled,
    mode: item.mode === 'LIVE' ? 'LIVE' : DEFAULTS.mode,
    pairs: Array.isArray(item.pairs) && item.pairs.length > 0
      ? item.pairs.map((p: Partial<PairConfig>) => ({ ...DEFAULT_PAIR_CONFIG, ...p }))
      : DEFAULTS.pairs,
    maxDrawdownPct: validateRange(item.maxDrawdownPct, 1, 50, DEFAULTS.maxDrawdownPct),
    minBalanceEUR: typeof item.minBalanceEUR === 'number' && item.minBalanceEUR > 0 ? item.minBalanceEUR : DEFAULTS.minBalanceEUR,
  };

  return config;
}

function validateRange(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== 'number' || value < min || value > max) return defaultValue;
  return value;
}

export { DEFAULTS as CONFIG_DEFAULTS, DEFAULT_PAIR_CONFIG };
