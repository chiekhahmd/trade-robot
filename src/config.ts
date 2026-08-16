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
  strategy: 'EMA_CROSSOVER' | 'RSI_MEAN_REVERSION';
  // EMA params (used when strategy = EMA_CROSSOVER)
  emaFastPeriod: number;
  emaSlowPeriod: number;
  // RSI params (used when strategy = RSI_MEAN_REVERSION)
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  // Risk params (per pair)
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  leverage: number;
}

const DEFAULT_PAIR_CONFIG: PairConfig = {
  pair: 'SOLEUR',
  strategy: 'RSI_MEAN_REVERSION',
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  rsiPeriod: 7,
  rsiOversold: 20,
  rsiOverbought: 80,
  stopLossPct: 2.0,
  takeProfitPct: 5.0,
  maxRiskPerTradePct: 10.0,
  leverage: 4,
};

const DEFAULTS: BotConfig = {
  enabled: true,
  mode: 'PAPER',
  pairs: [
    { ...DEFAULT_PAIR_CONFIG, pair: 'SOLEUR', strategy: 'RSI_MEAN_REVERSION', rsiPeriod: 7, rsiOversold: 20, rsiOverbought: 80 },
    { ...DEFAULT_PAIR_CONFIG, pair: 'XXBTZEUR', strategy: 'RSI_MEAN_REVERSION', rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70 },
  ],
  maxDrawdownPct: 10.0,
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
