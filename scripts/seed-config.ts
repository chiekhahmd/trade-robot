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
      pairs: ['SOLEUR', 'XXBTZEUR', 'XETHZEUR'].map((pair) => ({
        pair,
        strategy: 'MIXED',
        // Trend-follow structure (backtested best on 15-min)
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
      })),
    },
  }));

  console.log('✅ Config seeded (PAPER mode, 15-min MIXED strategy, 4x leverage)');
  console.log('');
  console.log('  Pairs: SOL/EUR, BTC/EUR, ETH/EUR');
  console.log('  Strategy: MIXED (regime-adaptive)');
  console.log('    - TREND regime → trend-follow (EMA21/55 + EMA100 filter), 4% trailing stop');
  console.log('    - RANGE regime → mean-revert RSI(14) 35/70, SL 2% / TP 4%');
  console.log('  Leverage: 4x');
  console.log('');
  console.log('  Currently PAPER mode. To go LIVE, update DynamoDB item:');
  console.log('  PK=CONFIG, SK=PARAMS → set mode="LIVE"');
}

seed().catch(console.error);
