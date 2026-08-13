/**
 * Configuration loader — reads bot config from DynamoDB.
 */
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface BotConfig {
  enabled: boolean;
  mode: 'PAPER' | 'LIVE';
  pairs: string[];
  emaFastPeriod: number;
  emaSlowPeriod: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxRiskPerTradePct: number;
  maxDrawdownPct: number;
  minBalanceEUR: number;
}

const DEFAULTS: BotConfig = {
  enabled: true,
  mode: 'PAPER',
  pairs: ['XXBTZEUR', 'XETHZEUR'],
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  stopLossPct: 1.5,
  takeProfitPct: 3.0,
  maxRiskPerTradePct: 2.0,
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

  return {
    enabled: typeof item.enabled === 'boolean' ? item.enabled : DEFAULTS.enabled,
    mode: item.mode === 'LIVE' ? 'LIVE' : DEFAULTS.mode,
    pairs: Array.isArray(item.pairs) && item.pairs.length > 0 ? item.pairs : DEFAULTS.pairs,
    emaFastPeriod: validatePeriod(item.emaFastPeriod, item.emaSlowPeriod, DEFAULTS.emaFastPeriod, 'fast'),
    emaSlowPeriod: validatePeriod(item.emaSlowPeriod, item.emaFastPeriod, DEFAULTS.emaSlowPeriod, 'slow'),
    stopLossPct: validateRange(item.stopLossPct, 0.1, 10, DEFAULTS.stopLossPct),
    takeProfitPct: validateRange(item.takeProfitPct, 0.1, 20, DEFAULTS.takeProfitPct),
    maxRiskPerTradePct: validateRange(item.maxRiskPerTradePct, 0.1, 10, DEFAULTS.maxRiskPerTradePct),
    maxDrawdownPct: validateRange(item.maxDrawdownPct, 1, 50, DEFAULTS.maxDrawdownPct),
    minBalanceEUR: typeof item.minBalanceEUR === 'number' && item.minBalanceEUR > 0 ? item.minBalanceEUR : DEFAULTS.minBalanceEUR,
  };
}

function validateRange(value: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof value !== 'number' || value < min || value > max) return defaultValue;
  return value;
}

function validatePeriod(value: unknown, otherPeriod: unknown, defaultValue: number, type: 'fast' | 'slow'): number {
  if (typeof value !== 'number' || value < 1) return defaultValue;
  if (typeof otherPeriod === 'number') {
    if (type === 'fast' && value >= otherPeriod) return defaultValue;
    if (type === 'slow' && value <= (otherPeriod as number)) return defaultValue;
  }
  return value;
}

export { DEFAULTS as CONFIG_DEFAULTS };
