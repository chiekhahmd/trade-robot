/**
 * Lambda Handler — main entry point, triggered every 30 minutes.
 *
 * Flow:
 * 1. Load config from DynamoDB
 * 2. Check bot enabled + drawdown state
 * 3. Fetch candles from Kraken
 * 4. For each pair: compute EMAs, check SL/TP, generate signal, execute orders
 * 5. Log everything
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { KrakenClient } from './kraken/client';
import { computeEMA } from './strategy/ema';
import { detectCrossover } from './strategy/signals';
import { calculatePositionSize, checkStopLoss, checkTakeProfit } from './trading/risk-manager';
import { loadConfig, BotConfig } from './config';
import { withRetry } from './utils/retry';
import { Position, RiskConfig } from './trading/types';

// Initialize clients outside handler for connection reuse across invocations
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'trading-bot';
const KRAKEN_SECRET_ARN = process.env.KRAKEN_SECRET_ARN || '';

let krakenClient: KrakenClient | null = null;

async function getKrakenClient(): Promise<KrakenClient> {
  if (krakenClient) return krakenClient;

  const secret = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: KRAKEN_SECRET_ARN }),
  );
  const { apiKey, privateKey } = JSON.parse(secret.SecretString || '{}');
  krakenClient = new KrakenClient(apiKey, privateKey);
  return krakenClient;
}

export const handler = async (): Promise<void> => {
  const cycleId = `cycle-${Date.now()}`;
  console.log(`[${cycleId}] Starting execution`);

  try {
    // 1. Load config
    const config = await loadConfig(ddbClient, TABLE_NAME);

    // 2. Check enabled
    if (!config.enabled) {
      console.log(`[${cycleId}] Bot is disabled, skipping`);
      await logSignal(cycleId, 'SYSTEM', 'HOLD', 0, 0, 0, 'Bot disabled');
      return;
    }

    // 3. Check drawdown state
    const drawdownState = await getDrawdownState();
    if (drawdownState?.disabled) {
      console.log(`[${cycleId}] Max drawdown reached, trading disabled`);
      await logSignal(cycleId, 'SYSTEM', 'HOLD', 0, 0, 0, 'Max drawdown');
      return;
    }

    // 4. Get Kraken client
    const kraken = await getKrakenClient();

    // 5. Process each pair
    for (const pair of config.pairs) {
      try {
        await processPair(pair, config, kraken, cycleId);
      } catch (error) {
        console.error(`[${cycleId}] Error processing ${pair}:`, error);
      }
    }

    // 6. Update portfolio snapshot
    await updateSnapshot(config, cycleId);

    console.log(`[${cycleId}] Execution complete`);
  } catch (error) {
    console.error(`[${cycleId}] Fatal error:`, error);
  }
};

async function processPair(
  pair: string,
  config: BotConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  // Fetch candles with retry
  const candles = await withRetry(() => kraken.getOHLC(pair, 30), { maxRetries: 3, baseDelay: 1000, multiplier: 2 });

  if (candles.length < config.emaSlowPeriod + 1) {
    console.log(`[${cycleId}] ${pair}: Not enough candles (${candles.length})`);
    return;
  }

  // Compute EMAs
  const closes = candles.map((c) => c.close);
  const ema9 = computeEMA(closes, config.emaFastPeriod);
  const ema21 = computeEMA(closes, config.emaSlowPeriod);

  const currentPrice = candles[candles.length - 1].close;
  const timestamp = candles[candles.length - 1].timestamp;

  // Check existing position for SL/TP
  const position = await getPosition(pair);
  if (position) {
    if (checkStopLoss(position, currentPrice)) {
      console.log(`[${cycleId}] ${pair}: STOP LOSS triggered at ${currentPrice}`);
      await closePosition(pair, position, currentPrice, 'STOP_LOSS', config, kraken, cycleId);
      return; // Don't open new position this cycle
    }
    if (checkTakeProfit(position, currentPrice)) {
      console.log(`[${cycleId}] ${pair}: TAKE PROFIT triggered at ${currentPrice}`);
      await closePosition(pair, position, currentPrice, 'TAKE_PROFIT', config, kraken, cycleId);
      return;
    }
  }

  // Generate signal
  const signal = detectCrossover(ema9, ema21, pair, currentPrice, timestamp);
  console.log(`[${cycleId}] ${pair}: Signal=${signal.signal} EMA9=${signal.ema9.toFixed(2)} EMA21=${signal.ema21.toFixed(2)} Price=${currentPrice}`);

  // Log signal
  await logSignal(cycleId, pair, signal.signal, signal.ema9, signal.ema21, currentPrice);

  // Execute based on signal
  if (signal.signal === 'BUY' && !position) {
    await openPosition(pair, currentPrice, config, kraken, cycleId);
  } else if (signal.signal === 'SELL' && position) {
    await closePosition(pair, position, currentPrice, 'SIGNAL', config, kraken, cycleId);
  }
}

async function openPosition(
  pair: string,
  price: number,
  config: BotConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  // Get balance
  const riskConfig: RiskConfig = {
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    maxRiskPerTradePct: config.maxRiskPerTradePct,
    maxDrawdownPct: config.maxDrawdownPct,
    minBalanceEUR: config.minBalanceEUR,
  };

  let balance = config.minBalanceEUR + 1; // Default for paper
  if (config.mode === 'LIVE') {
    const balances = await kraken.getBalance();
    balance = balances['ZEUR'] || 0;
  } else {
    // Paper mode: track virtual balance (simplified: use 50 EUR)
    balance = 50; // TODO: Track virtual balance in DynamoDB
  }

  const sizing = calculatePositionSize(price, balance, riskConfig);
  if (sizing.size <= 0) {
    console.log(`[${cycleId}] ${pair}: Skipping trade — ${sizing.reason}`);
    return;
  }

  // Place order
  let orderId = `paper-${Date.now()}`;
  if (config.mode === 'LIVE') {
    orderId = await kraken.addOrder({ pair, type: 'buy', volume: sizing.size.toFixed(8) });
  }

  // Save position
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
  console.log(`[${cycleId}] ${pair}: OPENED position — size=${sizing.size.toFixed(8)} SL=${sizing.stopLossPrice.toFixed(2)} TP=${sizing.takeProfitPrice.toFixed(2)}`);
}

async function closePosition(
  pair: string,
  position: Position,
  currentPrice: number,
  reason: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT',
  config: BotConfig,
  kraken: KrakenClient,
  cycleId: string,
): Promise<void> {
  let orderId = `paper-close-${Date.now()}`;
  if (config.mode === 'LIVE') {
    orderId = await kraken.addOrder({ pair, type: 'sell', volume: position.size.toFixed(8) });
  }

  const pnl = (currentPrice - position.entryPrice) * position.size;

  await deletePosition(pair);
  await logTrade(cycleId, pair, 'sell', position.size, position.entryPrice, currentPrice, pnl, reason, orderId, config.mode);
  console.log(`[${cycleId}] ${pair}: CLOSED position — reason=${reason} P&L=${pnl.toFixed(2)} EUR`);
}

// --- DynamoDB helpers ---

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

async function getDrawdownState(): Promise<{ disabled: boolean; peakValue: number; currentValue: number } | null> {
  const result = await ddbClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: 'DRAWDOWN', SK: 'STATE' } }));
  return result.Item as { disabled: boolean; peakValue: number; currentValue: number } | null;
}

async function logSignal(cycleId: string, pair: string, signal: string, ema9: number, ema21: number, closePrice: number, note?: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await ddbClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `SIGNAL#${pair}`, SK: `${Date.now()}`, signal, ema9, ema21, closePrice, cycleId, note, ttl },
  }));
}

async function logTrade(cycleId: string, pair: string, side: string, size: number, entryPrice: number, exitPrice: number, pnl: number, reason: string, orderId: string, mode: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await ddbClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `TRADE#${pair}`, SK: `${Date.now()}`, side, size, entryPrice, exitPrice, pnl, reason, orderId, mode, cycleId, ttl },
  }));
}

async function updateSnapshot(config: BotConfig, cycleId: string): Promise<void> {
  // Simplified: log a snapshot with basic info
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await ddbClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: 'SNAPSHOT', SK: `${Date.now()}`, cycleId, mode: config.mode, pairs: config.pairs, ttl },
  }));
}
