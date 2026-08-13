# Implementation Plan: Trading Bot

## Overview

An automated EMA crossover trading bot for BTC/EUR and ETH/EUR on Kraken, deployed as an AWS Lambda triggered every 30 minutes. Implementation follows a bottom-up approach: scaffold → pure logic → API client → risk management → persistence → orchestration → backtester → infrastructure → CI/CD → deployment.

## Tasks

- [x] 1. Project scaffold and configuration
  - [x] 1.1 Initialize project with package.json, tsconfig.json, and vitest.config.ts
    - Create `trade-robot/package.json` with dependencies: `aws-cdk-lib`, `constructs`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sns`, `@aws-sdk/client-secrets-manager`, `esbuild`
    - Dev dependencies: `typescript`, `vitest`, `fast-check`, `@types/node`, `tsx`, `aws-cdk`
    - Scripts: `build`, `test`, `deploy`, `synth`, `backtest`
    - Create `tsconfig.json` targeting ES2022, NodeNext module resolution, strict mode, outDir `dist/`
    - Create `vitest.config.ts` with test file patterns `test/**/*.test.ts` and `test/**/*.property.test.ts`
    - Create `cdk.json` pointing to `infra/bin/app.ts`
    - _Requirements: 17.1, 18.1_

  - [x] 1.2 Create directory structure and placeholder files
    - Create directories: `src/`, `src/kraken/`, `src/strategy/`, `src/trading/`, `src/logging/`, `src/alerts/`, `src/utils/`, `infra/bin/`, `infra/lib/`, `backtester/`, `dashboard/`, `test/strategy/`, `test/trading/`, `test/backtester/`
    - Create `src/strategy/types.ts` with Signal and SignalResult type definitions
    - Create `src/trading/types.ts` with Position, OrderParams, OrderResult, RiskConfig type definitions
    - Create `src/logging/types.ts` with SignalLog, TradeLog, SnapshotLog type definitions
    - Create `src/kraken/types.ts` with Candle and Kraken API response types
    - _Requirements: 1.2, 2.1, 3.1, 4.1, 11.1_

- [x] 2. Core strategy — EMA calculation
  - [x] 2.1 Implement EMA computation function
    - Create `src/strategy/ema.ts` with `computeEMA(prices: number[], period: number): number[]`
    - Seed with SMA of first `period` prices, then iterate with `k = 2 / (period + 1)`
    - Return empty array if `prices.length < period`
    - _Requirements: 2.1, 2.2_

  - [ ]* 2.2 Write property tests for EMA bounded by input range
    - **Property 2: EMA Values Bounded by Input Range**
    - **Validates: Requirements 2.1**

  - [ ]* 2.3 Write property test for EMA matches reference implementation
    - **Property 3: EMA Matches Reference Implementation**
    - **Validates: Requirements 2.2**

  - [ ]* 2.4 Write property test for EMA pair-independence
    - **Property 4: EMA Computation is Pair-Independent**
    - **Validates: Requirements 2.3**

  - [ ]* 2.5 Write property test for EMA format/parse round-trip
    - **Property 5: EMA Format/Parse Round-Trip**
    - **Validates: Requirements 2.4**

- [ ] 3. Core strategy — Signal detection
  - [x] 3.1 Implement crossover signal detection
    - Create `src/strategy/signals.ts` with `detectCrossover(ema9Values, ema21Values, pair, closePrice, timestamp): SignalResult`
    - Compare last two values of each EMA array to detect crossovers
    - Return BUY when currEma9 > currEma21 AND prevEma9 <= prevEma21
    - Return SELL when currEma9 < currEma21 AND prevEma9 >= prevEma21
    - Return HOLD otherwise
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 3.2 Write property test for signal detection exhaustive correctness
    - **Property 6: Signal Detection Exhaustive Correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 3.3 Write unit tests for signal detection with concrete examples
    - Test exact crossover at boundary (prevEma9 == prevEma21)
    - Test no crossover (both above, both below)
    - Test BUY and SELL signal generation
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Checkpoint — Core strategy tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Kraken API client
  - [-] 5.1 Implement Kraken authentication and request signing
    - Create `src/kraken/endpoints.ts` with base URL and endpoint path constants
    - Create `src/kraken/client.ts` with `KrakenClient` class
    - Implement HMAC-SHA512 signature: `sign(path, nonce, postData, privateKey)`
    - Use `Date.now()` as nonce, `crypto` module for HMAC
    - _Requirements: 1.1, 4.1, 7.3_

  - [ ] 5.2 Implement OHLC candle fetching and parsing
    - Add `getOHLC(pair, interval, since?)` method to KrakenClient
    - Parse Kraken's array response `[timestamp, open, high, low, close, vwap, volume, count]` into Candle objects
    - Fetch 50 candles per request for configured interval (30 min)
    - _Requirements: 1.1, 1.2, 1.5_

  - [ ]* 5.3 Write property test for candle parsing correctness
    - **Property 1: Candle Parsing Correctness**
    - **Validates: Requirements 1.2**

  - [ ] 5.4 Implement balance and order methods
    - Add `getBalance()` method returning `Record<string, number>`
    - Add `addOrder(params)` method for placing market orders
    - Add `getOpenOrders()` method for querying open orders
    - _Requirements: 4.1, 7.3_

- [ ] 6. Retry utility and error handling
  - [ ] 6.1 Implement retry with exponential backoff
    - Create `src/utils/retry.ts` with `withRetry<T>(fn, options): Promise<T>`
    - Support configurable `maxRetries`, `baseDelay`, `multiplier`
    - Handle 429 rate limit with Retry-After header parsing
    - Distinguish retryable (5xx, timeout) from non-retryable (4xx except 429) errors
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ]* 6.2 Write unit tests for retry logic
    - Test exponential delay timing (1s, 2s, 4s)
    - Test 429 Retry-After header handling
    - Test non-retryable error passthrough
    - Test max retry exhaustion
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 7. Risk manager
  - [ ] 7.1 Implement position sizing calculation
    - Create `src/trading/risk-manager.ts`
    - Implement `calculatePositionSize(entryPrice, balance, config): PositionSizeResult`
    - Ensure `size × (entryPrice - stopLossPrice) <= portfolio × riskPct`
    - Cap size at available balance, return 0 with reason if below minimum
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ] 7.2 Implement stop loss and take profit checks
    - Implement `checkStopLoss(position, currentPrice): boolean` — triggers when price <= stopLossPrice
    - Implement `checkTakeProfit(position, currentPrice): boolean` — triggers when price >= takeProfitPrice
    - Compute SL price: `entryPrice × (1 - stopLossPct / 100)`
    - Compute TP price: `entryPrice × (1 + takeProfitPct / 100)`
    - _Requirements: 5.1, 5.2, 6.1, 6.2_

  - [ ] 7.3 Implement max drawdown tracking and protection
    - Implement `checkMaxDrawdown(peakValue, currentValue, maxDrawdownPct): boolean`
    - Track peak equity and calculate drawdown percentage: `(peak - current) / peak × 100`
    - Return true (disable trading) when drawdown exceeds threshold
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 7.4 Write property tests for stop loss and take profit price calculation
    - **Property 7: Stop Loss and Take Profit Price Calculation**
    - **Validates: Requirements 5.1, 6.1**

  - [ ]* 7.5 Write property test for stop loss and take profit trigger correctness
    - **Property 8: Stop Loss and Take Profit Trigger Correctness**
    - **Validates: Requirements 5.2, 6.2**

  - [ ]* 7.6 Write property test for position sizing risk and balance limits
    - **Property 9: Position Sizing Respects Risk and Balance Limits**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 7.7 Write property test for peak equity tracking invariant
    - **Property 10: Peak Equity Tracking Invariant**
    - **Validates: Requirements 8.1**

  - [ ]* 7.8 Write property test for drawdown detection correctness
    - **Property 11: Drawdown Detection Correctness**
    - **Validates: Requirements 8.2**

- [ ] 8. Checkpoint — Risk manager and strategy tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Configuration loading and validation
  - [ ] 9.1 Implement config loading from DynamoDB
    - Create `src/config.ts` with `loadConfig(ddb, tableName): Promise<BotConfig>`
    - Read item `PK=CONFIG, SK=PARAMS` from DynamoDB
    - Apply documented defaults for missing/invalid fields
    - Validate: emaFastPeriod < emaSlowPeriod, stopLossPct in [0.1, 10], takeProfitPct in [0.1, 20]
    - _Requirements: 12.1, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 9.2 Write property test for config defaults applied for missing fields
    - **Property 14: Config Defaults Applied for Missing Fields**
    - **Validates: Requirements 13.3**

  - [ ]* 9.3 Write property test for config validation correctness
    - **Property 15: Config Validation Correctness**
    - **Validates: Requirements 13.4**

  - [ ]* 9.4 Write unit tests for config loading edge cases
    - Test fully missing config item (all defaults)
    - Test partial config (mix of present and missing)
    - Test invalid values trigger fallback to defaults
    - _Requirements: 13.3, 13.4_

- [ ] 10. Trade logging to DynamoDB
  - [ ] 10.1 Implement trade logger
    - Create `src/logging/trade-logger.ts` with `TradeLogger` class
    - Implement `logSignal(signal: SignalLog)` — writes to `PK=SIGNAL#{pair}, SK={timestamp}`
    - Implement `logTrade(trade: TradeLog)` — writes to `PK=TRADE#{pair}, SK={timestamp}`
    - Implement `logSnapshot(snapshot: SnapshotLog)` — writes to `PK=SNAPSHOT, SK={timestamp}`
    - Set TTL to 365 days from now on all records
    - Use `withRetry` for DynamoDB writes (3 retries, exponential backoff)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 10.2 Implement position and drawdown state management
    - Add methods to read/write position: `PK=POSITION#{pair}, SK=OPEN`
    - Add methods to read/write drawdown state: `PK=DRAWDOWN, SK=STATE`
    - Add method to delete position (on close)
    - _Requirements: 4.3, 5.4, 6.4, 8.1, 8.4_

  - [ ]* 10.3 Write unit tests for trade logger
    - Test signal log payload structure and TTL
    - Test trade log payload structure
    - Test snapshot log payload structure
    - Test retry on DynamoDB write failure
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [ ] 11. Alert notifier
  - [ ] 11.1 Implement SNS alert publisher with throttling
    - Create `src/alerts/notifier.ts` with `AlertNotifier` class
    - Implement `sendAlert(eventType, message, pair?, cycleId?)` publishing to SNS topic
    - Implement 5-minute throttle per event type (suppress duplicates within window)
    - Include event type, timestamp, pair, error message, and cycle ID in alert payload
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ]* 11.2 Write property test for alert throttling
    - **Property 16: Alert Throttling**
    - **Validates: Requirements 15.3**

  - [ ]* 11.3 Write unit tests for alert notifier
    - Test alert payload structure
    - Test throttling suppresses duplicate alerts within 5 minutes
    - Test different event types are throttled independently
    - _Requirements: 15.1, 15.2, 15.3_

- [ ] 12. Order manager (live + paper)
  - [ ] 12.1 Implement order manager with paper trading support
    - Create `src/trading/order-manager.ts` with `placeOrder(params): Promise<OrderResult>`
    - In LIVE mode: call `KrakenClient.addOrder()` and return real order ID
    - In PAPER mode: simulate fill using current close price, generate synthetic order ID
    - Tag all results with `mode: 'LIVE' | 'PAPER'`
    - _Requirements: 4.1, 4.2, 10.1, 10.2, 10.3, 10.4_

  - [ ]* 12.2 Write unit tests for order manager
    - Test paper mode generates synthetic order and does not call Kraken
    - Test live mode delegates to KrakenClient
    - Test order rejection handling (log + alert, no retry)
    - _Requirements: 4.1, 4.4, 10.1, 10.2_

- [ ] 13. Lambda handler — orchestration
  - [ ] 13.1 Implement Lambda handler entry point
    - Create `src/handler.ts` with `handler(event)` function
    - Initialize DynamoDB client, Secrets Manager client, and KrakenClient outside handler for connection reuse
    - Load config → check enabled → check drawdown → fetch candles → process pairs → log snapshot
    - Handle cold start by initializing clients at module level
    - _Requirements: 12.1, 12.2, 18.3, 18.4_

  - [ ] 13.2 Implement per-pair processing loop
    - For each configured pair: compute EMAs, check SL/TP on open positions, detect signals, execute orders
    - Process pairs sequentially within single invocation
    - Skip disabled bot with log entry
    - Skip if max drawdown reached with log entry
    - Implement 25-second timeout guard (graceful exit + alert)
    - _Requirements: 1.5, 3.4, 4.5, 5.3, 6.3, 8.3, 12.2, 14.5, 18.2, 18.4_

  - [ ]* 13.3 Write unit tests for handler orchestration
    - Test disabled bot skips execution and logs
    - Test drawdown-reached skips execution
    - Test candle fetch failure after retries skips cycle
    - Test successful BUY signal opens position
    - Test successful SELL signal closes position
    - Test SL/TP trigger closes position before signal check
    - _Requirements: 12.2, 8.3, 1.3, 1.4, 4.1, 4.2, 5.2, 6.2_

- [ ] 14. Checkpoint — All unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Backtester
  - [ ] 15.1 Implement backtester CLI with historical data fetching
    - Create `backtester/index.ts` as CLI entry point (parse args: `--pair`, `--from`, `--to`)
    - Fetch historical 30-min candles from Kraken public API (paginated with `since` parameter, 720 candles per request)
    - Use same `computeEMA()` and `detectCrossover()` functions from `src/strategy/`
    - _Requirements: 9.1, 9.2_

  - [ ] 15.2 Implement backtester simulator and report
    - Create `backtester/simulator.ts` with trade simulation logic
    - Apply same risk management rules (stop loss, take profit, position sizing) using close prices
    - Create `backtester/report.ts` to compute: totalTrades, winRate, totalPnl, maxDrawdown, sharpeRatio, avgTradeDuration
    - Output JSON report to stdout
    - _Requirements: 9.3, 9.4, 9.5_

  - [ ]* 15.3 Write property test for backtester determinism
    - **Property 12: Backtester Determinism**
    - **Validates: Requirements 9.5**

  - [ ]* 15.4 Write property test for backtest report serialization round-trip
    - **Property 13: Backtest Report Serialization Round-Trip**
    - **Validates: Requirements 9.6**

- [ ] 16. CDK infrastructure stack
  - [ ] 16.1 Implement CDK app entry point and trading bot stack
    - Create `infra/bin/app.ts` — CDK app entry, instantiate TradingBotStack
    - Create `infra/lib/trading-bot-stack.ts` with all resources:
      - DynamoDB table (`trading-bot`): PK/SK string keys, on-demand billing, TTL on `ttl` attribute, RETAIN removal policy
      - SNS topic (`trading-bot-alerts`) with email subscription (configurable via context/env)
      - Reference existing Secrets Manager secret (`trading-bot/kraken-api-key`)
      - Lambda function (`trading-bot`): Node.js 20, 256 MB, 30s timeout, bundled from `dist/`
      - EventBridge rule: `rate(30 minutes)` targeting the Lambda
      - IAM permissions: Lambda reads/writes DynamoDB, publishes to SNS, reads secret
    - _Requirements: 17.1, 17.4, 18.1_

  - [ ] 16.2 Add optional S3 dashboard bucket
    - Add S3 bucket for static dashboard hosting (`trading-bot-dashboard-{account}`)
    - Configure website index document
    - Guard behind a CDK context flag (`dashboardEnabled`)
    - _Requirements: 16.5_

  - [ ]* 16.3 Write CDK snapshot or assertion test
    - Test stack synthesizes without errors
    - Assert DynamoDB table has correct key schema and billing mode
    - Assert Lambda has correct timeout and memory
    - _Requirements: 17.1, 18.1_

- [ ] 17. CI/CD with GitHub Actions
  - [ ] 17.1 Create GitHub Actions workflow for test and deploy
    - Create `.github/workflows/deploy.yml`
    - Jobs: `test` (install, build, `vitest --run`), `deploy` (CDK deploy, triggered on main branch push)
    - Configure AWS credentials via OIDC or secrets
    - Use Node.js 20, cache node_modules
    - Add build step: bundle Lambda code with esbuild to `dist/`
    - _Requirements: 17.2, 18.1_

- [ ] 18. Checkpoint — Infrastructure synthesizes and tests pass
  - Ensure all tests pass, CDK synth succeeds, ask the user if questions arise.

- [ ] 19. Deploy and paper trading validation
  - [ ] 19.1 Create deployment script and seed DynamoDB config
    - Add npm script `deploy` that runs `cdk deploy --require-approval never`
    - Create a seed script (`scripts/seed-config.ts`) that writes the default CONFIG item to DynamoDB with `mode: "PAPER"`
    - Document Secrets Manager setup (manual: store Kraken API key + private key as JSON)
    - _Requirements: 10.3, 12.3, 13.1, 13.2_

  - [ ]* 19.2 Write integration test for end-to-end Lambda execution
    - Test handler with real DynamoDB (local or test table) and mocked Kraken client
    - Verify config load → signal generation → position management → logging flow
    - _Requirements: 10.4, 12.1, 14.5_

- [ ] 20. Optional: Performance dashboard
  - [ ] 20.1 Implement static HTML dashboard
    - Create `dashboard/index.html` with client-side JavaScript
    - Display: total P&L, win rate, total trades, open positions, current drawdown, bot status
    - Display table of 50 most recent trades (from DynamoDB via Lambda API or direct SDK call)
    - Display current EMA values and last signal per pair
    - Use AWS SDK for JavaScript v3 to query DynamoDB directly (Cognito or API Gateway for auth)
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 21. Final checkpoint — Full system validation
  - Ensure all tests pass, CDK synth succeeds, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All code is TypeScript, tested with Vitest and fast-check
- Property tests cover pure logic (EMA, signals, risk calculations, config validation)
- Paper trading mode simulates fills locally (Kraken has no spot paper trading API)
- AWS account: 948360714523, region: eu-west-3
- Target: $0/month AWS cost (free tier)
