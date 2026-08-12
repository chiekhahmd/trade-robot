# Requirements Document

## Introduction

This document defines the requirements for an automated cryptocurrency trading bot targeting the Kraken exchange (MiCA-licensed, EU-compliant). The bot implements a trend-following strategy using EMA crossover signals on 30-minute candles for BTC/EUR and ETH/EUR pairs. It runs as an AWS Lambda function triggered every 30 minutes by EventBridge, with strict risk management controls to protect capital. The system includes backtesting capability, paper trading mode, comprehensive trade logging to DynamoDB, and an optional performance dashboard.

## Glossary

- **Trading_Bot**: The automated trading system that executes the EMA crossover strategy on configured trading pairs
- **Strategy_Engine**: The component that computes EMA values and generates buy/sell signals from candle data
- **Order_Manager**: The component responsible for placing, monitoring, and closing orders on Kraken
- **Risk_Manager**: The component that enforces position sizing, stop loss, take profit, and drawdown limits
- **Backtester**: The component that runs the trading strategy against historical candle data and produces performance reports
- **Trade_Logger**: The component that records all signals, trades, and performance metrics to DynamoDB
- **Bot_Controller**: The component that manages the enabled/disabled state and runtime configuration of the Trading_Bot
- **Error_Handler**: The component that handles Kraken API failures with retry logic, exponential backoff, and alerting
- **Dashboard**: The optional web interface displaying trading performance, P&L, and bot status
- **EMA**: Exponential Moving Average — a weighted moving average giving more weight to recent prices
- **EMA_9**: The fast EMA computed over 9 periods (30-minute candles)
- **EMA_21**: The slow EMA computed over 21 periods (30-minute candles)
- **Crossover_Signal**: A trading signal generated when EMA_9 crosses above (bullish) or below (bearish) EMA_21
- **Candle**: An OHLCV (Open, High, Low, Close, Volume) data point for a 30-minute time interval
- **Position**: An open trade with entry price, size, stop loss, and take profit levels
- **Stop_Loss**: An automatic exit triggered when price moves against a position by a configured percentage
- **Take_Profit**: An automatic exit triggered when price reaches a configured profit target
- **Max_Drawdown**: The maximum allowed portfolio loss from peak equity before the bot stops trading
- **Paper_Trading_Mode**: A mode where the bot simulates trades without placing real orders on the exchange
- **DynamoDB_Table**: The AWS DynamoDB table storing trade logs, signals, and performance data
- **EventBridge_Rule**: The AWS EventBridge scheduled rule that triggers the Lambda function every 30 minutes
- **Kraken_API**: The Kraken exchange REST API used for market data and order management

## Requirements

### Requirement 1: Market Data Fetching

**User Story:** As a trader, I want the bot to fetch current OHLCV candle data from Kraken, so that the strategy engine has accurate market data to compute signals.

#### Acceptance Criteria

1. WHEN the EventBridge_Rule triggers the Trading_Bot, THE Trading_Bot SHALL fetch the most recent 50 candles (30-minute interval) for each configured trading pair from the Kraken_API
2. WHEN the Kraken_API returns valid candle data, THE Trading_Bot SHALL parse the response into an array of Candle objects containing open, high, low, close, volume, and timestamp fields
3. IF the Kraken_API returns an error or times out within 10 seconds, THEN THE Error_Handler SHALL retry the request up to 3 times with exponential backoff (1s, 2s, 4s)
4. IF all retry attempts for market data fail, THEN THE Error_Handler SHALL log the failure to the DynamoDB_Table and skip the current execution cycle without placing any orders
5. THE Trading_Bot SHALL fetch candle data for BTC/EUR and ETH/EUR pairs independently and in parallel

### Requirement 2: EMA Calculation

**User Story:** As a trader, I want the bot to compute EMA values accurately from candle data, so that crossover signals are reliable.

#### Acceptance Criteria

1. WHEN candle data is available, THE Strategy_Engine SHALL compute EMA_9 and EMA_21 using the closing prices of the fetched candles
2. THE Strategy_Engine SHALL use the standard EMA formula: EMA_today = (Close × k) + (EMA_yesterday × (1 − k)), where k = 2 / (period + 1)
3. THE Strategy_Engine SHALL compute EMA values independently for each configured trading pair
4. FOR ALL valid sequences of closing prices, computing the EMA then formatting then re-parsing the values SHALL produce numerically equivalent results within a tolerance of 0.00000001 (round-trip property)

### Requirement 3: Signal Generation

**User Story:** As a trader, I want the bot to generate clear buy and sell signals based on EMA crossovers, so that trades are entered and exited systematically.

#### Acceptance Criteria

1. WHEN EMA_9 crosses above EMA_21 (current EMA_9 > EMA_21 and previous EMA_9 <= EMA_21), THE Strategy_Engine SHALL generate a BUY Crossover_Signal for the trading pair
2. WHEN EMA_9 crosses below EMA_21 (current EMA_9 < EMA_21 and previous EMA_9 >= EMA_21), THE Strategy_Engine SHALL generate a SELL Crossover_Signal for the trading pair
3. WHEN no crossover is detected, THE Strategy_Engine SHALL generate a HOLD signal and take no trading action
4. THE Trade_Logger SHALL record every generated signal (BUY, SELL, HOLD) to the DynamoDB_Table with timestamp, pair, EMA_9 value, EMA_21 value, and close price

### Requirement 4: Order Placement

**User Story:** As a trader, I want the bot to place orders on Kraken when signals are generated, so that trades are executed without manual intervention.

#### Acceptance Criteria

1. WHEN the Strategy_Engine generates a BUY signal and no open Position exists for the trading pair, THE Order_Manager SHALL place a market buy order on the Kraken_API with the size determined by the Risk_Manager
2. WHEN the Strategy_Engine generates a SELL signal and an open BUY Position exists for the trading pair, THE Order_Manager SHALL place a market sell order on the Kraken_API to close the full position
3. WHEN an order is placed, THE Order_Manager SHALL record the order ID, pair, side, size, price, and timestamp in the DynamoDB_Table
4. IF the Kraken_API rejects an order, THEN THE Order_Manager SHALL log the rejection reason and send an alert without retrying the order
5. THE Order_Manager SHALL process BTC/EUR and ETH/EUR trading pairs independently so that a signal on one pair does not affect the other pair

### Requirement 5: Stop Loss Execution

**User Story:** As a trader, I want automatic stop loss protection on every position, so that losses are limited to a configured percentage.

#### Acceptance Criteria

1. WHEN a new Position is opened, THE Risk_Manager SHALL calculate the stop loss price at a configurable percentage (default 1.5%) below the entry price for BUY positions
2. WHEN the current price reaches or falls below the stop loss price of an open Position, THE Order_Manager SHALL immediately close the position with a market sell order
3. THE Risk_Manager SHALL evaluate stop loss conditions on every execution cycle for all open positions
4. WHEN a stop loss is triggered, THE Trade_Logger SHALL record the exit with reason "STOP_LOSS", entry price, exit price, and realized loss amount

### Requirement 6: Take Profit Execution

**User Story:** As a trader, I want automatic take profit targets on every position, so that gains are locked in at a configured percentage.

#### Acceptance Criteria

1. WHEN a new Position is opened, THE Risk_Manager SHALL calculate the take profit price at a configurable percentage (default 3%) above the entry price for BUY positions
2. WHEN the current price reaches or exceeds the take profit price of an open Position, THE Order_Manager SHALL immediately close the position with a market sell order
3. THE Risk_Manager SHALL evaluate take profit conditions on every execution cycle for all open positions
4. WHEN a take profit is triggered, THE Trade_Logger SHALL record the exit with reason "TAKE_PROFIT", entry price, exit price, and realized gain amount

### Requirement 7: Position Sizing

**User Story:** As a trader, I want the bot to calculate position sizes based on risk parameters, so that no single trade risks more than a configured percentage of my portfolio.

#### Acceptance Criteria

1. THE Risk_Manager SHALL calculate position size such that the maximum loss (entry price to stop loss price) does not exceed a configurable percentage (default 2%) of the total portfolio value
2. WHEN the calculated position size would exceed the available balance for the trading pair, THE Risk_Manager SHALL reduce the position size to the maximum affordable amount
3. THE Risk_Manager SHALL fetch the current account balance from the Kraken_API before calculating position size
4. IF the available balance is below a configurable minimum threshold (default 10 EUR), THEN THE Risk_Manager SHALL skip the trade and log the reason as "INSUFFICIENT_BALANCE"

### Requirement 8: Maximum Drawdown Protection

**User Story:** As a trader, I want the bot to stop trading if portfolio losses exceed a maximum threshold, so that catastrophic losses are prevented.

#### Acceptance Criteria

1. THE Risk_Manager SHALL track the peak portfolio value and current portfolio value across all trading pairs
2. WHEN the portfolio value drops by more than a configurable percentage (default 10%) from the peak value, THE Risk_Manager SHALL disable trading and log the event as "MAX_DRAWDOWN_REACHED"
3. WHILE the Max_Drawdown limit is reached, THE Trading_Bot SHALL not open any new positions until manually re-enabled by the operator
4. THE Trade_Logger SHALL record the drawdown event with peak value, current value, and drawdown percentage

### Requirement 9: Backtesting

**User Story:** As a trader, I want to run the strategy against historical data before going live, so that I can evaluate performance and tune parameters.

#### Acceptance Criteria

1. WHEN a backtest is initiated with a date range and trading pair, THE Backtester SHALL fetch historical 30-minute candles from the Kraken_API for the specified period
2. THE Backtester SHALL execute the same Strategy_Engine logic (EMA crossover signals, Risk_Manager rules) against historical candles in chronological order
3. THE Backtester SHALL simulate position entries and exits using historical close prices without connecting to live order execution
4. WHEN the backtest completes, THE Backtester SHALL produce a report containing: total trades, win rate, total P&L, maximum drawdown, Sharpe ratio, and average trade duration
5. THE Backtester SHALL produce identical signal sequences when run multiple times with the same input data and parameters (deterministic output)
6. FOR ALL valid historical candle sequences, running the Backtester then serializing the report then deserializing SHALL produce an equivalent report object (round-trip property)

### Requirement 10: Paper Trading Mode

**User Story:** As a trader, I want to run the bot in paper trading mode using Kraken's demo environment, so that I can validate the strategy with simulated money before risking real capital.

#### Acceptance Criteria

1. WHILE Paper_Trading_Mode is enabled, THE Order_Manager SHALL send all orders to the Kraken demo API endpoint instead of the production endpoint
2. WHILE Paper_Trading_Mode is enabled, THE Trade_Logger SHALL tag all logged trades with mode "PAPER" to distinguish them from real trades
3. THE Trading_Bot SHALL switch between paper and live modes through a configuration parameter without code changes or redeployment
4. THE Trading_Bot SHALL execute the same strategy logic, risk management, and logging in Paper_Trading_Mode as in live mode

### Requirement 11: Trade Logging

**User Story:** As a trader, I want every signal and trade recorded, so that I can review bot decisions and track performance over time.

#### Acceptance Criteria

1. THE Trade_Logger SHALL record every signal event to the DynamoDB_Table with: timestamp, pair, signal type, EMA_9 value, EMA_21 value, close price, and execution cycle ID
2. THE Trade_Logger SHALL record every trade execution to the DynamoDB_Table with: timestamp, pair, side, size, entry price, exit price, P&L, fees, reason (SIGNAL, STOP_LOSS, TAKE_PROFIT), and order ID
3. THE Trade_Logger SHALL record a portfolio snapshot after each execution cycle with: total equity, unrealized P&L, realized P&L, and open positions count
4. IF a write to the DynamoDB_Table fails, THEN THE Trade_Logger SHALL retry the write up to 3 times with exponential backoff before logging the failure to CloudWatch
5. THE Trade_Logger SHALL store records with a TTL of 365 days to manage storage costs within the free tier

### Requirement 12: Bot Enable/Disable Control

**User Story:** As a trader, I want to enable or disable the bot without redeploying, so that I can quickly pause trading during volatile markets or maintenance.

#### Acceptance Criteria

1. THE Bot_Controller SHALL check an enabled/disabled flag stored in a DynamoDB configuration item at the start of every execution cycle
2. WHILE the bot is disabled, THE Trading_Bot SHALL skip strategy execution and order placement, log the skipped cycle, and exit gracefully
3. THE Bot_Controller SHALL allow updating the enabled/disabled flag via a direct DynamoDB update without requiring a Lambda redeployment
4. WHEN the bot transitions from disabled to enabled, THE Trading_Bot SHALL resume normal operation on the next scheduled execution cycle

### Requirement 13: Runtime Configuration

**User Story:** As a trader, I want to change strategy parameters (EMA periods, stop loss %, take profit %, position size %) without redeploying, so that I can tune the bot based on market conditions.

#### Acceptance Criteria

1. THE Bot_Controller SHALL load all configurable parameters from a DynamoDB configuration item at the start of each execution cycle
2. THE Bot_Controller SHALL support the following configurable parameters: EMA fast period, EMA slow period, stop loss percentage, take profit percentage, max risk per trade percentage, max drawdown percentage, minimum balance threshold, and trading pairs list
3. WHEN a configuration parameter is missing or invalid, THE Bot_Controller SHALL use the documented default value and log a warning
4. THE Bot_Controller SHALL validate that EMA fast period is less than EMA slow period, stop loss percentage is between 0.1 and 10, and take profit percentage is between 0.1 and 20

### Requirement 14: Error Handling and Retry Logic

**User Story:** As a trader, I want the bot to handle API errors gracefully with retries and backoff, so that transient failures do not cause missed trades or incorrect state.

#### Acceptance Criteria

1. WHEN the Kraken_API returns an HTTP 5xx error or a network timeout, THE Error_Handler SHALL retry the request up to 3 times with exponential backoff (base delay 1 second, multiplier 2)
2. WHEN the Kraken_API returns an HTTP 429 (rate limit), THE Error_Handler SHALL wait for the duration specified in the Retry-After header before retrying
3. WHEN the Kraken_API returns an HTTP 4xx error (excluding 429), THE Error_Handler SHALL not retry the request and SHALL log the error with full request context
4. IF all retry attempts fail for a critical operation (order placement or position check), THEN THE Error_Handler SHALL send an alert notification and log the failure as a critical event
5. THE Error_Handler SHALL ensure that no partial state changes persist after a failed execution cycle (the cycle either completes fully or rolls back to the previous state)

### Requirement 15: Alerting

**User Story:** As a trader, I want to receive alerts for critical events, so that I can intervene when the bot encounters problems or triggers risk limits.

#### Acceptance Criteria

1. WHEN a critical error occurs (all retries exhausted, max drawdown reached, or unexpected exception), THE Error_Handler SHALL publish an alert to an SNS topic
2. THE Error_Handler SHALL include in each alert: event type, timestamp, trading pair (if applicable), error message, and execution cycle ID
3. THE Error_Handler SHALL not send more than 1 alert of the same type within a 5-minute window to prevent alert flooding
4. WHEN the bot is re-enabled after being disabled by Max_Drawdown protection, THE Error_Handler SHALL send a confirmation alert

### Requirement 16: Performance Dashboard

**User Story:** As a trader, I want a simple web page showing bot performance, so that I can monitor trades, P&L, and win rate at a glance.

#### Acceptance Criteria

1. WHERE the Dashboard feature is enabled, THE Dashboard SHALL display the following metrics: total P&L, win rate, total trades count, open positions, current drawdown, and bot status (enabled/disabled)
2. WHERE the Dashboard feature is enabled, THE Dashboard SHALL display a table of the 50 most recent trades with timestamp, pair, side, entry price, exit price, P&L, and exit reason
3. WHERE the Dashboard feature is enabled, THE Dashboard SHALL display the current EMA values and last signal for each trading pair
4. WHERE the Dashboard feature is enabled, THE Dashboard SHALL read data from the DynamoDB_Table and refresh on page load
5. WHERE the Dashboard feature is enabled, THE Dashboard SHALL be served as a static HTML page (with client-side JavaScript) hosted on S3 or within the Lambda function

### Requirement 17: Cost Optimization

**User Story:** As a trader, I want the bot to operate within the AWS free tier ($0/month target), so that running costs do not eat into trading profits.

#### Acceptance Criteria

1. THE Trading_Bot SHALL execute within the AWS Lambda free tier limit of 1 million requests and 400,000 GB-seconds per month
2. THE Trading_Bot SHALL complete each execution cycle (fetch data, compute signals, place orders, log results) within 15 seconds to minimize Lambda duration costs
3. THE Trade_Logger SHALL use DynamoDB on-demand capacity mode and keep total storage under 25 GB to remain within the free tier
4. THE Trading_Bot SHALL use EventBridge Scheduler (included in free tier) for the 30-minute trigger schedule

### Requirement 18: Lambda Execution Constraints

**User Story:** As a trader, I want the bot to execute reliably within Lambda constraints, so that no execution is cut short or produces incomplete results.

#### Acceptance Criteria

1. THE Trading_Bot SHALL configure the Lambda function with a timeout of 30 seconds and 256 MB memory
2. WHEN an execution cycle approaches the Lambda timeout (25 seconds elapsed), THE Trading_Bot SHALL gracefully terminate, log the timeout risk, and send an alert
3. THE Trading_Bot SHALL handle Lambda cold starts by initializing Kraken API client and DynamoDB client outside the handler function for connection reuse
4. THE Trading_Bot SHALL process both trading pairs within a single Lambda invocation to minimize the number of monthly invocations
