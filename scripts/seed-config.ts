/**
 * Seed DynamoDB with the new multi-strategy config.
 * Run: AWS_PROFILE=society-personal npx tsx scripts/seed-config.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-3' }));
const TABLE_NAME = process.env.TABLE_NAME || 'trading-bot';

async function seed() {
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'CONFIG',
      SK: 'PARAMS',
      enabled: true,
      mode: 'PAPER',
      maxDrawdownPct: 15,
      minBalanceEUR: 10,
      pairs: [
        {
          pair: 'SOLEUR',
          strategy: 'RSI_MEAN_REVERSION',
          rsiPeriod: 14,
          rsiOversold: 30,
          rsiOverbought: 70,
          stopLossPct: 2.0,
          takeProfitPct: 4.0,
          maxRiskPerTradePct: 10.0,
          leverage: 4,
          emaFastPeriod: 9,
          emaSlowPeriod: 21,
        },
        {
          pair: 'XXBTZEUR',
          strategy: 'RSI_MEAN_REVERSION',
          rsiPeriod: 14,
          rsiOversold: 30,
          rsiOverbought: 70,
          stopLossPct: 2.0,
          takeProfitPct: 4.0,
          maxRiskPerTradePct: 10.0,
          leverage: 4,
          emaFastPeriod: 9,
          emaSlowPeriod: 21,
        },
        {
          pair: 'XETHZEUR',
          strategy: 'RSI_MEAN_REVERSION',
          rsiPeriod: 14,
          rsiOversold: 30,
          rsiOverbought: 70,
          stopLossPct: 2.0,
          takeProfitPct: 4.0,
          maxRiskPerTradePct: 10.0,
          leverage: 4,
          emaFastPeriod: 9,
          emaSlowPeriod: 21,
        },
      ],
    },
  }));

  console.log('✅ Config seeded (PAPER mode, 15-min RSI(14) strategy)');
  console.log('');
  console.log('  Pair 1: SOL/EUR — RSI(14), oversold=30, overbought=70, SL=2%, TP=4%, 4x leverage');
  console.log('  Pair 2: BTC/EUR — RSI(14), oversold=30, overbought=70, SL=2%, TP=4%, 4x leverage');
  console.log('  Pair 3: ETH/EUR — RSI(14), oversold=30, overbought=70, SL=2%, TP=4%, 4x leverage');
  console.log('');
  console.log('  EUR/USD dropped (negative P&L on all strategies)');
  console.log('');
  console.log('  To switch to LIVE mode, update the DynamoDB item:');
  console.log('  PK=CONFIG, SK=PARAMS → set mode="LIVE"');
}

seed().catch(console.error);
