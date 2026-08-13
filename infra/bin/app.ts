#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TradingBotStack } from '../lib/trading-bot-stack';

const app = new cdk.App();

new TradingBotStack(app, 'TradingBot', {
  env: {
    account: '948360714523',
    region: 'eu-west-3',
  },
});

app.synth();
