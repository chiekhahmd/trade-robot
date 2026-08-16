/**
 * Dashboard Lambda — serves HTML UI and JSON API via Function URL.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME || 'trading-bot';

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const path = event.rawPath || '/';

  try {
    if (path === '/api/signals') {
      return jsonResponse(await getSignals());
    }
    if (path === '/api/trades') {
      return jsonResponse(await getTrades());
    }
    if (path === '/api/config') {
      return jsonResponse(await getConfig());
    }
    if (path === '/api/positions') {
      return jsonResponse(await getPositions());
    }
    // Default: serve HTML dashboard
    return htmlResponse(buildDashboardHTML());
  } catch (error) {
    console.error('Dashboard error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

// ─── Data fetchers ───────────────────────────────────────────────────────────

async function getSignals(): Promise<unknown[]> {
  const result = await ddbClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'SIGNAL#' },
    Limit: 1000,
  }));
  const items = result.Items || [];
  items.sort((a, b) => Number(b.SK) - Number(a.SK));
  return items.slice(0, 50);
}

async function getTrades(): Promise<unknown[]> {
  const result = await ddbClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'TRADE#' },
    Limit: 1000,
  }));
  const items = result.Items || [];
  items.sort((a, b) => Number(b.SK) - Number(a.SK));
  return items.slice(0, 50);
}

async function getConfig(): Promise<Record<string, unknown>> {
  const result = await ddbClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: 'CONFIG', SK: 'PARAMS' },
  }));
  return (result.Item as Record<string, unknown>) || {};
}

async function getPositions(): Promise<unknown[]> {
  const result = await ddbClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'POSITION#' },
    Limit: 1000,
  }));
  return result.Items || [];
}

// ─── Response helpers ────────────────────────────────────────────────────────

function jsonResponse(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function htmlResponse(body: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  };
}

// ─── HTML Dashboard ──────────────────────────────────────────────────────────

function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trading Bot Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  background: #0d1117;
  color: #c9d1d9;
  padding: 16px;
  line-height: 1.5;
}
h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4rem; }
h2 { color: #8b949e; margin: 24px 0 12px; font-size: 1.1rem; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
}
.card-label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
.card-value { font-size: 1.5rem; font-weight: 700; margin-top: 4px; }
.enabled { color: #3fb950; }
.disabled { color: #f85149; }
.paper { color: #d29922; }
.live { color: #f85149; }
.pnl-positive { color: #3fb950; }
.pnl-negative { color: #f85149; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  background: #161b22;
  border-radius: 8px;
  overflow: hidden;
}
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #21262d; }
th { background: #1c2128; color: #8b949e; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.5px; }
tr:hover { background: #1c2128; }
.refresh-info { color: #484f58; font-size: 0.75rem; margin-top: 16px; text-align: center; }
.pair-tag { background: #1f6feb22; color: #58a6ff; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; }
.signal-buy { color: #3fb950; font-weight: 700; }
.signal-sell { color: #f85149; font-weight: 700; }
.signal-hold { color: #8b949e; }
.positions-empty { color: #484f58; font-style: italic; padding: 12px; }
@media (max-width: 768px) {
  body { padding: 8px; }
  table { font-size: 0.7rem; }
  th, td { padding: 6px; }
  .card-value { font-size: 1.2rem; }
  .grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 480px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<h1>&#x1F916; Trading Bot Dashboard</h1>
<div id="status-line" style="color:#484f58;font-size:0.75rem;margin-bottom:16px;">Loading...</div>

<div class="grid" id="cards"></div>

<h2>Open Positions</h2>
<div id="positions"></div>

<h2>Recent Signals (last 20 per pair)</h2>
<div style="overflow-x:auto;" id="signals-container"></div>

<h2>Recent Trades</h2>
<div style="overflow-x:auto;" id="trades-container"></div>

<div class="refresh-info" id="refresh-info">Auto-refresh every 60s</div>

<script>
function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function pnlClass(v) { return v >= 0 ? 'pnl-positive' : 'pnl-negative'; }
function signalClass(s) { return s === 'BUY' ? 'signal-buy' : s === 'SELL' ? 'signal-sell' : 'signal-hold'; }

async function fetchJSON(url) {
  const r = await fetch(url);
  return r.json();
}

async function loadDashboard() {
  try {
    const [config, signals, trades, positions] = await Promise.all([
      fetchJSON('/api/config'),
      fetchJSON('/api/signals'),
      fetchJSON('/api/trades'),
      fetchJSON('/api/positions'),
    ]);

    // Status cards
    const enabled = config.enabled !== false;
    const mode = config.mode || 'PAPER';
    const pairs = (config.pairs || []).map(p => p.pair).join(', ') || '—';
    const strategies = [...new Set((config.pairs || []).map(p => p.strategy))].join(', ') || '—';
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    document.getElementById('cards').innerHTML = \`
      <div class="card"><div class="card-label">Status</div><div class="card-value \${enabled ? 'enabled' : 'disabled'}">\${enabled ? 'ENABLED' : 'DISABLED'}</div></div>
      <div class="card"><div class="card-label">Mode</div><div class="card-value \${mode === 'LIVE' ? 'live' : 'paper'}">\${mode}</div></div>
      <div class="card"><div class="card-label">Pairs</div><div class="card-value" style="font-size:1rem;">\${pairs}</div></div>
      <div class="card"><div class="card-label">Strategies</div><div class="card-value" style="font-size:1rem;">\${strategies}</div></div>
      <div class="card"><div class="card-label">Total P&amp;L</div><div class="card-value \${pnlClass(totalPnl)}">\${totalPnl >= 0 ? '+' : ''}\${totalPnl.toFixed(4)} EUR</div></div>
      <div class="card"><div class="card-label">Total Trades</div><div class="card-value">\${trades.length}</div></div>
    \`;

    // Positions
    const posDiv = document.getElementById('positions');
    if (positions.length === 0) {
      posDiv.innerHTML = '<div class="positions-empty">No open positions</div>';
    } else {
      posDiv.innerHTML = '<table><thead><tr><th>Pair</th><th>Side</th><th>Entry</th><th>Size</th><th>SL</th><th>TP</th><th>Opened</th></tr></thead><tbody>' +
        positions.map(p => \`<tr>
          <td><span class="pair-tag">\${p.pair || (p.PK || '').replace('POSITION#','')}</span></td>
          <td>\${p.side || '—'}</td>
          <td>\${p.entryPrice ? Number(p.entryPrice).toFixed(4) : '—'}</td>
          <td>\${p.size ? Number(p.size).toFixed(6) : '—'}</td>
          <td>\${p.stopLossPrice ? Number(p.stopLossPrice).toFixed(4) : '—'}</td>
          <td>\${p.takeProfitPrice ? Number(p.takeProfitPrice).toFixed(4) : '—'}</td>
          <td>\${fmt(p.openedAt)}</td>
        </tr>\`).join('') + '</tbody></table>';
    }

    // Signals — last 20 per pair
    const signalsByPair = {};
    signals.forEach(s => {
      const pair = (s.PK || '').replace('SIGNAL#', '');
      if (!signalsByPair[pair]) signalsByPair[pair] = [];
      if (signalsByPair[pair].length < 20) signalsByPair[pair].push(s);
    });
    const allDisplaySignals = Object.values(signalsByPair).flat();
    allDisplaySignals.sort((a, b) => Number(b.SK) - Number(a.SK));

    document.getElementById('signals-container').innerHTML = '<table><thead><tr><th>Time</th><th>Pair</th><th>Signal</th><th>Strategy</th><th>Ind1</th><th>Ind2</th><th>Price</th></tr></thead><tbody>' +
      allDisplaySignals.map(s => \`<tr>
        <td>\${fmt(s.SK)}</td>
        <td><span class="pair-tag">\${(s.PK || '').replace('SIGNAL#','')}</span></td>
        <td class="\${signalClass(s.signal)}">\${s.signal || '—'}</td>
        <td>\${s.strategy || '—'}</td>
        <td>\${s.indicator1 != null ? Number(s.indicator1).toFixed(2) : '—'}</td>
        <td>\${s.indicator2 != null ? Number(s.indicator2).toFixed(2) : '—'}</td>
        <td>\${s.closePrice ? Number(s.closePrice).toFixed(4) : '—'}</td>
      </tr>\`).join('') + '</tbody></table>';

    // Trades — last 20
    const displayTrades = trades.slice(0, 20);
    document.getElementById('trades-container').innerHTML = '<table><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th><th>Reason</th></tr></thead><tbody>' +
      displayTrades.map(t => \`<tr>
        <td>\${fmt(t.SK)}</td>
        <td><span class="pair-tag">\${(t.PK || '').replace('TRADE#','')}</span></td>
        <td class="\${t.side === 'buy' ? 'signal-buy' : 'signal-sell'}">\${t.side || '—'}</td>
        <td>\${t.entryPrice ? Number(t.entryPrice).toFixed(4) : '—'}</td>
        <td>\${t.exitPrice ? Number(t.exitPrice).toFixed(4) : '—'}</td>
        <td>\${t.size ? Number(t.size).toFixed(6) : '—'}</td>
        <td class="\${pnlClass(t.pnl || 0)}">\${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + Number(t.pnl).toFixed(4) : '—'}</td>
        <td>\${t.reason || '—'}</td>
      </tr>\`).join('') + '</tbody></table>';

    document.getElementById('status-line').textContent = 'Last updated: ' + new Date().toLocaleTimeString('fr-FR');
  } catch (e) {
    document.getElementById('status-line').textContent = 'Error loading data: ' + e.message;
    console.error(e);
  }
}

loadDashboard();
setInterval(loadDashboard, 60000);
</script>
</body>
</html>`;
}
