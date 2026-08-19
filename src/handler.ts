/**
 * Lambda Handler — triggered every 30 minutes.
 * Supports multiple strategies per pair: EMA_CROSSOVER and RSI_MEAN_REVERSION.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { KrakenClient } from './kraken/client';
import { computeEMA } from './strategy/ema';
import { detectCrossover } from './strategy/signals';
import { computeRSI } from './strategy/rsi';
import { detectRSISignal } from './strategy/rsi-signals';
import { calculatePositionSize, checkStopLoss, checkTakeProfit } from './trading/risk-manager';
import { loadConfig, BotConfig, PairConfig } from './config';
import { withRetry } from './utils/retry';
import { Position, RiskConfig } from './trading/types';
import { SignalResult } from './strategy/types';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'trading-bot';
const KRAKEN_SECRET_ARN = process.env.KRAKEN_SECRET_ARN || '';

let krakenClient: KrakenClient | null = null;

async function getKrakenClient(): Promise<KrakenClient> {
  if (krakenClient) return krakenClient;
  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: KRAKEN_SECRET_ARN }));
  const { apiKey, privateKey } = JSON.parse(secret.SecretString || '{}');
  krakenClient = new KrakenClient(apiKey, privateKey);
  return krakenClient;
}

export const handler = async (): Promise<void> => {
  const cycleId = `cycle-${Date.now()}`;
  console.log(`[${cycleId}] Starting execution`);

  try {
    const config = await loadConfig(ddbClient, TABLE_NAME);

    if (!config.enabled) {
      console.log(`[${cycleId}] Bot disabled, skipping`);
      return;
    }

    const drawdownState = await getDrawdownState();
    if (drawdownState?.disabled) {
      console.log(`[${cycleId}] Max drawdown reached, trading disabled`);
      return;
    }

    const kraken = await getKrakenClient();

    for (const pairConfig of config.pairs) {
      try {
        await processPair(pairConfig, config, kraken, cycleId);
      } catch (error) {
        console.error(`[${cycleId}] Error processing ${pairConfig.pair}:`, error);
      }
    }

    console.log(`[${cycleId}] Execution complete`);
  } catch (error) {
    console.error(`[${cycleId}] Fatal error:`, error);
  }
};

async function processPair(
  pairConfig: PairConfig,
  config: BotConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  const { pair, strategy } = pairConfig;

  // Fetch candles
  const candles = await withRetry(() => kraken.getOHLC(pair, 15), { maxRetries: 3, baseDelay: 1000, multiplier: 2 });

  const minCandles = strategy === 'EMA_CROSSOVER'
    ? pairConfig.emaSlowPeriod + 2
    : pairConfig.rsiPeriod + 2;

  if (candles.length < minCandles) {
    console.log(`[${cycleId}] ${pair}: Not enough candles (${candles.length})`);
    return;
  }

  const closes = candles.map((c) => c.close);
  const currentPrice = candles[candles.length - 1].close;
  const timestamp = candles[candles.length - 1].timestamp;

  // Check existing position for SL/TP
  const position = await getPosition(pair);
  if (position) {
    if (checkStopLoss(position, currentPrice)) {
      console.log(`[${cycleId}] ${pair}: STOP LOSS at ${currentPrice}`);
      await closePosition(pair, position, currentPrice, 'STOP_LOSS', config, pairConfig, kraken, cycleId);
      return;
    }
    if (checkTakeProfit(position, currentPrice)) {
      console.log(`[${cycleId}] ${pair}: TAKE PROFIT at ${currentPrice}`);
      await closePosition(pair, position, currentPrice, 'TAKE_PROFIT', config, pairConfig, kraken, cycleId);
      return;
    }
  }

  // Generate signal based on strategy
  let signal: SignalResult;

  if (strategy === 'RSI_MEAN_REVERSION') {
    const rsiValues = computeRSI(closes, pairConfig.rsiPeriod);
    signal = detectRSISignal(rsiValues, pair, currentPrice, timestamp, {
      period: pairConfig.rsiPeriod,
      oversold: pairConfig.rsiOversold,
      overbought: pairConfig.rsiOverbought,
    });
  } else {
    // EMA_CROSSOVER
    const ema9 = computeEMA(closes, pairConfig.emaFastPeriod);
    const ema21 = computeEMA(closes, pairConfig.emaSlowPeriod);
    signal = detectCrossover(ema9, ema21, pair, currentPrice, timestamp);
  }

  console.log(`[${cycleId}] ${pair} [${strategy}]: Signal=${signal.signal} Price=${currentPrice}`);

  // Log signal
  await logSignal(cycleId, pair, signal.signal, signal.ema9, signal.ema21, currentPrice, strategy);

  // Execute
  if (signal.signal === 'BUY' && !position) {
    await openPosition(pair, currentPrice, config, pairConfig, kraken, cycleId);
  } else if (signal.signal === 'SELL' && position) {
    await closePosition(pair, position, currentPrice, 'SIGNAL', config, pairConfig, kraken, cycleId);
  }
}

async function openPosition(
  pair: string,
  price: number,
  config: BotConfig,
  pairConfig: PairConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  const riskConfig: RiskConfig = {
    stopLossPct: pairConfig.stopLossPct,
    takeProfitPct: pairConfig.takeProfitPct,
    maxRiskPerTradePct: pairConfig.maxRiskPerTradePct,
    maxDrawdownPct: config.maxDrawdownPct,
    minBalanceEUR: config.minBalanceEUR,
    leverage: pairConfig.leverage,
  };

  // Get available margin (real capital). Leverage is applied inside calculatePositionSize.
  let balance = 100; // Default margin for paper
  if (config.mode === 'LIVE') {
    const balances = await kraken.getBalance();
    balance = balances['ZEUR'] || 0;
  }

  const sizing = calculatePositionSize(price, balance, riskConfig);
  if (sizing.size <= 0) {
    console.log(`[${cycleId}] ${pair}: Skip — ${sizing.reason}`);
    return;
  }

  let orderId = `paper-${Date.now()}`;
  if (config.mode === 'LIVE') {
    orderId = await kraken.addOrder({
      pair,
      type: 'buy',
      volume: sizing.size.toFixed(8),
      leverage: pairConfig.leverage,
    });
  }

  const position: Position = {
    pair,
    side: 'buy',
    entryPrice: price,
    size: sizing.size,
    stopLossPrice: sizing.stopLossPrice,
    takeProfitPrice: sizing.takeProfitPrice,
    openedAt: Date.now(),
    orderId,
  };

  await savePosition(pair, position);
  await logTrade(cycleId, pair, 'buy', sizing.size, price, 0, 0, 'SIGNAL', orderId, config.mode);
  console.log(`[${cycleId}] ${pair}: OPENED — size=${sizing.size.toFixed(6)} SL=${sizing.stopLossPrice.toFixed(4)} TP=${sizing.takeProfitPrice.toFixed(4)}`);
}

async function closePosition(
  pair: string,
  position: Position,
  currentPrice: number,
  reason: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT',
  config: BotConfig,
  pairConfig: PairConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  let orderId = `paper-close-${Date.now()}`;
  if (config.mode === 'LIVE') {
    orderId = await kraken.addOrder({
      pair,
      type: 'sell',
      volume: position.size.toFixed(8),
      leverage: pairConfig.leverage,
    });
  }

  const pnl = (currentPrice - position.entryPrice) * position.size;
  await deletePosition(pair);
  await logTrade(cycleId, pair, 'sell', position.size, position.entryPrice, currentPrice, pnl, reason, orderId, config.mode);
  console.log(`[${cycleId}] ${pair}: CLOSED — reason=${reason} P&L=${pnl.toFixed(4)}`);
}

// ─── DynamoDB helpers ────────────────────────────────────────────────────────

async function getPosition(pair: string): Promise<Position | null> {
  const result = await ddbClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `POSITION#${pair}`, SK: 'OPEN' } }));
  return (result.Item as Position) || null;
}

async function savePosition(pair: string, position: Position): Promise<void> {
  await ddbClient.send(new PutCommand({ TableName: TABLE_NAME, Item: { PK: `POSITION#${pair}`, SK: 'OPEN', ...position } }));
}

async function deletePosition(pair: string): Promise<void> {
  await ddbClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `POSITION#${pair}`, SK: 'OPEN' } }));
}

async function getDrawdownState(): Promise<{ disabled: boolean } | null> {
  const result = await ddbClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: 'DRAWDOWN', SK: 'STATE' } }));
  return result.Item as { disabled: boolean } | null;
}

async function logSignal(cycleId: string, pair: string, signal: string, val1: number, val2: number, closePrice: number, strategy: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await ddbClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `SIGNAL#${pair}`, SK: `${Date.now()}`, signal, indicator1: val1, indicator2: val2, closePrice, cycleId, strategy, ttl },
  }));
}

async function logTrade(cycleId: string, pair: string, side: string, size: number, entryPrice: number, exitPrice: number, pnl: number, reason: string, orderId: string, mode: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await ddbClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `TRADE#${pair}`, SK: `${Date.now()}`, side, size, entryPrice, exitPrice, pnl, reason, orderId, mode, cycleId, ttl },
  }));
}
