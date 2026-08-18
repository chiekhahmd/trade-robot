import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export class TradingBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB — single table for all state
    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'trading-bot',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // SNS — alerts topic
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'trading-bot-alerts',
    });

    // Add email subscription if configured
    const alertEmail = this.node.tryGetContext('alertEmail') as string;
    if (alertEmail) {
      alertTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    }

    // Secrets Manager — Kraken API key (created manually, referenced here)
    const krakenSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'KrakenSecret', 'trading-bot/kraken-api-key',
    );

    // Lambda function
    const fn = new lambda.Function(this, 'TradingBotFunction', {
      functionName: 'trading-bot',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
        KRAKEN_SECRET_ARN: krakenSecret.secretArn,
      },
    });

    // Permissions
    table.grantReadWriteData(fn);
    alertTopic.grantPublish(fn);
    krakenSecret.grantRead(fn);

    // EventBridge — trigger every 30 minutes
    const rule = new events.Rule(this, 'ScheduleRule', {
      ruleName: 'trading-bot-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
    });
    rule.addTarget(new targets.LambdaFunction(fn));

    // ─── Dashboard Lambda ──────────────────────────────────────────────────────

    const dashboardFn = new lambda.Function(this, 'DashboardFunction', {
      functionName: 'trading-bot-dashboard',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'dashboard.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    table.grantReadData(dashboardFn);

    const dashboardUrl = dashboardFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Outputs
    new cdk.CfnOutput(this, 'FunctionArn', { value: fn.functionArn });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'AlertTopicArn', { value: alertTopic.topicArn });
    new cdk.CfnOutput(this, 'DashboardUrl', { value: dashboardUrl.url });
  }
}
