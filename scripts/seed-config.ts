/**
 * Seed DynamoDB with default bot configuration.
 * Run: npx tsx scripts/seed-config.ts
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
      mode: 'PAPER', // Start in paper mode!
      pairs: ['XXBTZEUR', 'XETHZEUR'],
      emaFastPeriod: 9,
      emaSlowPeriod: 21,
      stopLossPct: 1.5,
      takeProfitPct: 3.0,
      maxRiskPerTradePct: 2.0,
      maxDrawdownPct: 10.0,
      minBalanceEUR: 10,
    },
  }));

  console.log('✅ Config seeded successfully (PAPER mode)');
  console.log('   Table:', TABLE_NAME);
  console.log('   Mode: PAPER (no real trades)');
  console.log('   Pairs: BTC/EUR, ETH/EUR');
  console.log('   EMA: 9/21 on 30-min candles');
  console.log('   Stop Loss: 1.5%, Take Profit: 3%');
}

seed().catch(console.error);
