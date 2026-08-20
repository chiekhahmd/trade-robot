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
    if (path === '/api/roundtrips') {
      return jsonResponse(await getRoundTrips());
    }
    if (path === '/api/config') {
      return jsonResponse(await getConfig());
    }
    if (path === '/api/positions') {
      return jsonResponse(await getPositions());
    }
    if (path === '/api/prices') {
      return jsonResponse(await getLivePrices());
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

interface RoundTrip {
  pair: string;
  entryPrice: number;
  exitPrice: number | null;
  size: number;
  pnl: number | null;
  openedAt: number | null;
  closedAt: number | null;
  reason: string;
  mode: string;
  status: 'OPEN' | 'CLOSED';
}

/**
 * Pair each buy (open) with its subsequent sell (close) per pair, oldest→newest,
 * collapsing the two log legs into a single long round-trip row.
 */
async function getRoundTrips(): Promise<RoundTrip[]> {
  const result = await ddbClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'TRADE#' },
    Limit: 1000,
  }));
  const items = (result.Items || []) as Record<string, any>[];

  // Group legs by pair, oldest first
  const byPair: Record<string, Record<string, any>[]> = {};
  for (const it of items) {
    const pair = String(it.PK || '').replace('TRADE#', '');
    (byPair[pair] ||= []).push(it);
  }

  const roundTrips: RoundTrip[] = [];
  for (const [pair, legs] of Object.entries(byPair)) {
    legs.sort((a, b) => Number(a.SK) - Number(b.SK));
    let open: Record<string, any> | null = null;
    for (const leg of legs) {
      if (leg.side === 'buy') {
        // If a previous open never closed, record it as still open before starting a new one
        if (open) roundTrips.push(toOpenRoundTrip(pair, open));
        open = leg;
      } else if (leg.side === 'sell') {
        roundTrips.push({
          pair,
          entryPrice: Number(open?.entryPrice ?? leg.entryPrice),
          exitPrice: Number(leg.exitPrice),
          size: Number(leg.size),
          pnl: Number(leg.pnl),
          openedAt: open ? Number(open.SK) : null,
          closedAt: Number(leg.SK),
          reason: String(leg.reason || '—'),
          mode: String(leg.mode || '—'),
          status: 'CLOSED',
        });
        open = null;
      }
    }
    if (open) roundTrips.push(toOpenRoundTrip(pair, open));
  }

  // Newest first by close time (fall back to open time)
  roundTrips.sort((a, b) => (b.closedAt ?? b.openedAt ?? 0) - (a.closedAt ?? a.openedAt ?? 0));
  return roundTrips.slice(0, 50);
}

function toOpenRoundTrip(pair: string, open: Record<string, any>): RoundTrip {
  return {
    pair,
    entryPrice: Number(open.entryPrice),
    exitPrice: null,
    size: Number(open.size),
    pnl: null,
    openedAt: Number(open.SK),
    closedAt: null,
    reason: 'OPEN',
    mode: String(open.mode || '—'),
    status: 'OPEN',
  };
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

/**
 * Fetch live prices from Kraken's public Ticker API for all open positions.
 */
async function getLivePrices(): Promise<Record<string, number>> {
  const positions = await getPositions() as Record<string, any>[];
  const pairs = [...new Set(positions.map((p) => p.pair).filter(Boolean))];
  if (pairs.length === 0) return {};

  try {
    const url = `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    if (data.error?.length) return {};
    const prices: Record<string, number> = {};
    for (const [key, val] of Object.entries(data.result || {})) {
      prices[key] = parseFloat((val as any).c?.[0] || '0');
    }
    return prices;
  } catch {
    return {};
  }
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
    const [config, signals, roundtrips, positions, prices] = await Promise.all([
      fetchJSON('/api/config'),
      fetchJSON('/api/signals'),
      fetchJSON('/api/roundtrips'),
      fetchJSON('/api/positions'),
      fetchJSON('/api/prices'),
    ]);

    // Status cards
    const enabled = config.enabled !== false;
    const mode = config.mode || 'PAPER';
    const pairs = (config.pairs || []).map(p => p.pair).join(', ') || '—';
    const strategies = [...new Set((config.pairs || []).map(p => p.strategy))].join(', ') || '—';
    const leverage = (config.pairs || []).map(p => p.leverage).filter(Boolean);
    const leverageLabel = leverage.length ? Math.max(...leverage) + 'x' : '1x';
    const closed = roundtrips.filter(t => t.status === 'CLOSED');
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const winRate = closed.length ? (wins / closed.length * 100).toFixed(0) + '%' : '—';

    document.getElementById('cards').innerHTML = \`
      <div class="card"><div class="card-label">Status</div><div class="card-value \${enabled ? 'enabled' : 'disabled'}">\${enabled ? 'ENABLED' : 'DISABLED'}</div></div>
      <div class="card"><div class="card-label">Mode</div><div class="card-value \${mode === 'LIVE' ? 'live' : 'paper'}">\${mode}</div></div>
      <div class="card"><div class="card-label">Pairs</div><div class="card-value" style="font-size:1rem;">\${pairs}</div></div>
      <div class="card"><div class="card-label">Strategies</div><div class="card-value" style="font-size:1rem;">\${strategies}</div></div>
      <div class="card"><div class="card-label">Leverage</div><div class="card-value">\${leverageLabel}</div></div>
      <div class="card"><div class="card-label">Total P&amp;L</div><div class="card-value \${pnlClass(totalPnl)}">\${totalPnl >= 0 ? '+' : ''}\${totalPnl.toFixed(4)} EUR</div></div>
      <div class="card"><div class="card-label">Closed Trades</div><div class="card-value">\${closed.length}</div></div>
      <div class="card"><div class="card-label">Win Rate</div><div class="card-value">\${winRate}</div></div>
    \`;

    // Positions
    const posDiv = document.getElementById('positions');
    if (positions.length === 0) {
      posDiv.innerHTML = '<div class="positions-empty">No open positions</div>';
    } else {
      const MAX_SAFE = 9007199254740991;
      posDiv.innerHTML = '<table><thead><tr><th>Pair</th><th>Regime</th><th>Entry</th><th>Current</th><th>Size</th><th>Stop (live)</th><th>Target</th><th>Unrealized P&L</th><th>Opened</th></tr></thead><tbody>' +
        positions.map(p => {
          const isTrend = p.regime === 'TREND';
          const tp = Number(p.takeProfitPrice);
          const tpCell = (!p.takeProfitPrice || tp >= MAX_SAFE || isTrend)
            ? '<span class="signal-hold">Trailing</span>'
            : tp.toFixed(4);
          const entryP = Number(p.entryPrice || 0);
          const size = Number(p.size || 0);
          const pair = p.pair || (p.PK || '').replace('POSITION#', '');
          // Look up live price (Kraken may return a slightly different key)
          const livePrice = prices[pair] || Object.values(prices).find((v, i) => Object.keys(prices)[i]?.includes(pair)) || 0;
          const currentP = Number(livePrice) || 0;

          // For TREND positions, compute the live trailing stop
          const highWater = Math.max(Number(p.highWater || 0), currentP);
          const trailPct = Number(p.trailPct || 4);
          const liveStop = isTrend ? highWater * (1 - trailPct / 100) : Number(p.stopLossPrice || 0);
          const stopLabel = isTrend ? ' (trail)' : '';

          const unrealizedPnl = currentP > 0 ? (currentP - entryP) * size : 0;
          const pnlStr = currentP > 0 ? (unrealizedPnl >= 0 ? '+' : '') + unrealizedPnl.toFixed(4) : '—';
          const pnlCls = currentP > 0 ? pnlClass(unrealizedPnl) : '';

          return \`<tr>
          <td><span class="pair-tag">\${pair}</span></td>
          <td>\${p.regime || '—'}</td>
          <td>\${entryP ? entryP.toFixed(4) : '—'}</td>
          <td>\${currentP ? currentP.toFixed(4) : '—'}</td>
          <td>\${size ? size.toFixed(6) : '—'}</td>
          <td>\${liveStop ? liveStop.toFixed(4) + stopLabel : '—'}</td>
          <td>\${tpCell}</td>
          <td class="\${pnlCls}">\${pnlStr}</td>
          <td>\${fmt(p.openedAt)}</td>
        </tr>\`;
        }).join('') + '</tbody></table>';
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

    // Trades — round-trips (one row per open→close cycle)
    const displayTrades = roundtrips.slice(0, 20);
    document.getElementById('trades-container').innerHTML = '<table><thead><tr><th>Opened</th><th>Closed</th><th>Pair</th><th>Direction</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th><th>Exit Reason</th></tr></thead><tbody>' +
      displayTrades.map(t => \`<tr>
        <td>\${fmt(t.openedAt)}</td>
        <td>\${t.status === 'OPEN' ? '<span class="signal-hold">— open —</span>' : fmt(t.closedAt)}</td>
        <td><span class="pair-tag">\${t.pair}</span></td>
        <td class="signal-buy">LONG</td>
        <td>\${t.entryPrice ? Number(t.entryPrice).toFixed(4) : '—'}</td>
        <td>\${t.exitPrice != null ? Number(t.exitPrice).toFixed(4) : '—'}</td>
        <td>\${t.size ? Number(t.size).toFixed(6) : '—'}</td>
        <td class="\${t.pnl == null ? '' : pnlClass(t.pnl)}">\${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + Number(t.pnl).toFixed(4) : '—'}</td>
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
