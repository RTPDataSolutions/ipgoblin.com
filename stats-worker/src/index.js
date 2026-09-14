/**
 * stats.ipgoblin.com — a password-protected traffic dashboard.
 *
 * Cloudflare already counts every request it proxies, so this reads those
 * aggregates back out of the GraphQL analytics API. Nothing is tracked on the
 * site itself and no visitor data is stored here.
 *
 * The Cloudflare API token lives in a Worker secret and is only ever used
 * server-side, so it never reaches the browser. This runs as its own Worker
 * rather than as a route on the public API so that a mistake in the public
 * surface cannot expose the token.
 *
 * Setup (once):
 *   npx wrangler secret put CF_API_TOKEN     # Account Analytics:Read + Zone Analytics:Read
 *   npx wrangler secret put STATS_PASSWORD   # whatever you want to type in the browser
 */

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const DOH = 'https://cloudflare-dns.com/dns-query';
const USER = 'goblin';
const REALM = 'IP Goblin stats';

/** Free-plan retention for the daily dataset. */
const MAX_DAYS = 7;

/** Raw grouped rows pulled per visitor pass, before deduplication. */
const VISITOR_ROWS = 2000;
const RECENT_ROWS = 500;

/** Visitors rendered, and how many of those get a reverse-DNS lookup. */
const VISITOR_LIMIT = 120;
const PTR_LIMIT = 36;
const PTR_CONCURRENCY = 12;
const PTR_TIMEOUT_MS = 2000;

const SECURITY_HEADERS = {
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/* ---------- auth ---------- */

/**
 * Compares without an early return, so the time taken does not reveal how much
 * of the password was correct.
 */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Length alone is not secret, but keep the loop a fixed size regardless.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

function authorized(request, password) {
  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (!encoded || scheme.toLowerCase() !== 'basic') return false;

  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const split = decoded.indexOf(':');
  if (split < 0) return false;

  // Evaluate both halves every time so a wrong username costs the same as a
  // wrong password.
  const userOk = safeEqual(decoded.slice(0, split), USER);
  const passOk = safeEqual(decoded.slice(split + 1), password);
  return userOk && passOk;
}

/* ---------- cloudflare analytics ---------- */

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

function isoTime(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600000);
  return d.toISOString().slice(0, 19) + 'Z';
}

async function graphql(token, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Cloudflare analytics returned ${res.status}`);

  const body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

const DAILY_QUERY = `query($zone:String!,$from:Date!,$to:Date!){
  viewer{zones(filter:{zoneTag:$zone}){
    httpRequests1dGroups(limit:${MAX_DAYS},orderBy:[date_ASC],filter:{date_geq:$from,date_leq:$to}){
      dimensions{date} sum{requests pageViews bytes} uniq{uniques}
    }
  }}
}`;

// The free plan only answers the adaptive dataset for a 24 hour window.
const BREAKDOWN_QUERY = `query($zone:String!,$from:Time!,$to:Time!){
  viewer{zones(filter:{zoneTag:$zone}){
    httpRequestsAdaptiveGroups(limit:50,orderBy:[count_DESC],filter:{datetime_geq:$from,datetime_lt:$to}){
      count dimensions{clientRequestHTTPHost clientCountryName}
    }
  }}
}`;

const WORKER_QUERY = `query($account:String!,$script:String!,$from:Time!,$to:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$from,datetime_lt:$to,scriptName:$script}){
      sum{requests errors} dimensions{status}
    }
  }}
}`;

// One row per (ip, country, device, agent, path). Collapsed to one row per
// visitor in buildVisitors below.
const VISITOR_QUERY = `query($zone:String!,$from:Time!,$to:Time!){
  viewer{zones(filter:{zoneTag:$zone}){
    httpRequestsAdaptiveGroups(limit:${VISITOR_ROWS},orderBy:[count_DESC],filter:{datetime_geq:$from,datetime_lt:$to}){
      count dimensions{clientIP clientCountryName clientDeviceType userAgent clientRequestPath}
    }
  }}
}`;

// Separate pass purely for recency: the identity query is ordered by volume,
// so it cannot also tell us who showed up most recently.
const RECENT_QUERY = `query($zone:String!,$from:Time!,$to:Time!){
  viewer{zones(filter:{zoneTag:$zone}){
    httpRequestsAdaptiveGroups(limit:${RECENT_ROWS},orderBy:[datetimeMinute_DESC],filter:{datetime_geq:$from,datetime_lt:$to}){
      dimensions{clientIP datetimeMinute}
    }
  }}
}`;

/* ---------- visitors ---------- */

/** 1.2.3.4 -> 4.3.2.1.in-addr.arpa, or the nibble form for IPv6. */
function reverseName(ip) {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
    return parts.reverse().join('.') + '.in-addr.arpa';
  }
  const full = expandIPv6(ip);
  if (!full) return null;
  return full.split('').reverse().join('.') + '.ip6.arpa';
}

/** Expands an IPv6 address to its 32 bare hex digits. */
function expandIPv6(ip) {
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;

  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  return groups.map((g) => g.padStart(4, '0')).join('').toLowerCase();
}

async function lookupPTR(ip) {
  const name = reverseName(ip);
  if (!name) return null;

  // Never let a slow resolver hold up the whole dashboard.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PTR_TIMEOUT_MS);
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=PTR`, {
      headers: { accept: 'application/dns-json' },
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const answer = (body.Answer || []).find((a) => a.type === 12);
    return answer ? answer.data.replace(/\.$/, '') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves in small batches so we stay well inside the subrequest budget. */
async function resolveHostnames(visitors) {
  const targets = visitors.slice(0, PTR_LIMIT);
  for (let i = 0; i < targets.length; i += PTR_CONCURRENCY) {
    const batch = targets.slice(i, i + PTR_CONCURRENCY);
    const names = await Promise.all(batch.map((v) => lookupPTR(v.ip)));
    batch.forEach((v, n) => { v.hostname = names[n]; });
  }
}

/** Boils a user agent down to something readable in a narrow column. */
function uaLabel(ua) {
  if (!ua) return 'unknown';

  const bot = ua.match(/(Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|Applebot|facebookexternalhit|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|CensysInspect|InternetMeasurement|Expanse|NetSystemsResearch|CorePropagation|l9scan|LeakIX|Odin|masscan|zgrab|Nuclei|Nmap|sqlmap|python-requests|aiohttp|httpx|curl|wget|Go-http-client|Java|libwww-perl|axios|okhttp|Scrapy|HeadlessChrome)/i);
  if (bot) return bot[1];
  if (/bot|crawler|spider|scanner|scan\b/i.test(ua)) return 'other bot';

  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : null;

  const os =
    /Windows/.test(ua) ? 'Windows' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser || os) return browser || os;

  // Unrecognised: surface the first product token that actually identifies
  // something, rather than the boilerplate every agent copies.
  const token = ua
    .match(/[A-Za-z][A-Za-z0-9._-]*\/[0-9][\w.]*/g)
    ?.find((t) => !/^(Mozilla|AppleWebKit|KHTML|Gecko|Version|Safari|Chrome|Mobile)\//i.test(t));

  return token || ua.slice(0, 28);
}

/** Picks the most frequently seen value from a count map. */
function topKey(map) {
  let best = null;
  let bestCount = -1;
  for (const [key, count] of map) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
}

/**
 * Collapses the grouped rows into one entry per client IP, so a visitor who
 * hit twelve URLs is a single line with a hit count rather than twelve lines.
 */
function buildVisitors(rows, recent) {
  if (rows.error) return { error: rows.error };

  const byIP = new Map();
  for (const row of rows) {
    const { clientIP: ip, clientCountryName, clientDeviceType, userAgent, clientRequestPath } =
      row.dimensions;
    if (!ip) continue;

    let v = byIP.get(ip);
    if (!v) {
      v = {
        ip,
        hits: 0,
        paths: new Set(),
        countries: new Map(),
        devices: new Map(),
        agents: new Map(),
        hostname: null,
        lastSeen: null,
      };
      byIP.set(ip, v);
    }

    v.hits += row.count;
    if (clientRequestPath) v.paths.add(clientRequestPath);
    bump(v.countries, clientCountryName, row.count);
    bump(v.devices, clientDeviceType, row.count);
    bump(v.agents, userAgent, row.count);
  }

  if (!recent.error) {
    for (const row of recent) {
      const v = byIP.get(row.dimensions.clientIP);
      // Rows arrive newest first, so the first one we see per IP wins.
      if (v && !v.lastSeen) v.lastSeen = row.dimensions.datetimeMinute;
    }
  }

  return [...byIP.values()]
    .map((v) => ({
      ip: v.ip,
      hits: v.hits,
      paths: v.paths.size,
      country: topKey(v.countries),
      device: topKey(v.devices),
      agent: uaLabel(topKey(v.agents)),
      hostname: null,
      lastSeen: v.lastSeen,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, VISITOR_LIMIT);
}

function bump(map, key, by) {
  if (key === null || key === undefined || key === '') return;
  map.set(key, (map.get(key) || 0) + by);
}

async function collect(env) {
  const zone = env.ZONE_ID;
  const account = env.ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  const from = isoTime(23);
  const to = isoTime(0);

  // One round trip each, in parallel. A single failure should not blank the
  // whole page, so each section degrades on its own.
  const [daily, breakdown, worker, visitorRows, recentRows] = await Promise.all([
    graphql(token, DAILY_QUERY, { zone, from: isoDate(MAX_DAYS - 1), to: isoDate(0) })
      .then((d) => d.viewer.zones[0].httpRequests1dGroups)
      .catch((e) => ({ error: e.message })),
    graphql(token, BREAKDOWN_QUERY, { zone, from, to })
      .then((d) => d.viewer.zones[0].httpRequestsAdaptiveGroups)
      .catch((e) => ({ error: e.message })),
    graphql(token, WORKER_QUERY, { account, script: env.WORKER_NAME, from, to })
      .then((d) => d.viewer.accounts[0].workersInvocationsAdaptive)
      .catch((e) => ({ error: e.message })),
    graphql(token, VISITOR_QUERY, { zone, from, to })
      .then((d) => d.viewer.zones[0].httpRequestsAdaptiveGroups)
      .catch((e) => ({ error: e.message })),
    graphql(token, RECENT_QUERY, { zone, from, to })
      .then((d) => d.viewer.zones[0].httpRequestsAdaptiveGroups)
      .catch((e) => ({ error: e.message })),
  ]);

  const visitors = buildVisitors(visitorRows, recentRows);
  if (!visitors.error) await resolveHostnames(visitors);

  return { daily, breakdown, worker, visitors, generated: new Date().toISOString() };
}

/* ---------- rendering ---------- */

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function flagEmoji(code) {
  if (!code || code.length !== 2 || !/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function num(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function section(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

function errorBox(message) {
  return `<p class="err">Could not load: ${esc(message)}</p>`;
}

function renderDaily(rows) {
  if (rows.error) return errorBox(rows.error);
  if (!rows.length) return '<p class="muted">No data yet.</p>';

  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.sum.requests,
      pageViews: acc.pageViews + r.sum.pageViews,
      uniques: acc.uniques + r.uniq.uniques,
      bytes: acc.bytes + r.sum.bytes,
    }),
    { requests: 0, pageViews: 0, uniques: 0, bytes: 0 }
  );

  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.dimensions.date)}</td>
        <td class="n">${num(r.sum.requests)}</td>
        <td class="n">${num(r.sum.pageViews)}</td>
        <td class="n">${num(r.uniq.uniques)}</td>
        <td class="n">${esc(mb(r.sum.bytes))}</td>
      </tr>`
    )
    .join('');

  return `<table>
    <thead><tr><th>Date</th><th class="n">Requests</th><th class="n">Page views</th><th class="n">Uniques</th><th class="n">Data</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="n">${num(totals.requests)}</td>
      <td class="n">${num(totals.pageViews)}</td>
      <td class="n">${num(totals.uniques)}</td>
      <td class="n">${esc(mb(totals.bytes))}</td>
    </tr></tfoot>
  </table>`;
}

function renderBreakdown(rows) {
  if (rows.error) return errorBox(rows.error);
  if (!rows.length) return '<p class="muted">No data yet.</p>';

  const byHost = new Map();
  const byCountry = new Map();
  for (const r of rows) {
    const host = r.dimensions.clientRequestHTTPHost;
    const country = r.dimensions.clientCountryName;
    byHost.set(host, (byHost.get(host) || 0) + r.count);
    byCountry.set(country, (byCountry.get(country) || 0) + r.count);
  }

  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

  const hostRows = sorted(byHost)
    .map(([host, n]) => `<tr><td>${esc(host)}</td><td class="n">${num(n)}</td></tr>`)
    .join('');

  const countryRows = sorted(byCountry)
    .slice(0, 15)
    .map(
      ([country, n]) =>
        `<tr><td>${flagEmoji(country)} ${esc(country)}</td><td class="n">${num(n)}</td></tr>`
    )
    .join('');

  return `<div class="cols">
    <div><h3>By hostname</h3><table><tbody>${hostRows}</tbody></table></div>
    <div><h3>By country</h3><table><tbody>${countryRows}</tbody></table></div>
  </div>`;
}

function renderWorker(rows) {
  if (rows.error) return errorBox(rows.error);
  if (!rows.length) return '<p class="muted">No requests in the last 24 hours.</p>';

  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.dimensions.status)}</td>
        <td class="n">${num(r.sum.requests)}</td>
        <td class="n">${num(r.sum.errors)}</td>
      </tr>`
    )
    .join('');

  return `<table>
    <thead><tr><th>Status</th><th class="n">Requests</th><th class="n">Errors</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderVisitors(rows) {
  if (rows.error) return errorBox(rows.error);
  if (!rows.length) return '<p class="muted">No visitors in the last 24 hours.</p>';

  const repeat = rows.filter((r) => r.hits > 1).length;
  const named = rows.filter((r) => r.hostname).length;

  const body = rows
    .map((r) => {
      const who = r.hostname
        ? `<span class="host">${esc(r.hostname)}</span>`
        : '<span class="muted">no reverse DNS</span>';
      return `<tr>
        <td>${who}<br><span class="ip">${esc(r.ip)}</span></td>
        <td>${flagEmoji(r.country)} ${esc(r.country || '??')}</td>
        <td>${esc(r.agent)}</td>
        <td>${esc(r.device || '?')}</td>
        <td class="n">${num(r.hits)}</td>
        <td class="n">${num(r.paths)}</td>
        <td class="ts">${esc(r.lastSeen ? r.lastSeen.slice(11, 16) + ' UTC' : '—')}</td>
      </tr>`;
    })
    .join('');

  return `<p class="muted">${num(rows.length)} unique visitors &middot; ${num(repeat)} came back for more
    &middot; ${num(named)} gave up a hostname</p>
  <div class="scroll"><table>
    <thead><tr>
      <th>Host / IP</th><th>From</th><th>Agent</th><th>Device</th>
      <th class="n">Hits</th><th class="n">Paths</th><th>Last</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function page(stats, zoneName) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>IP Goblin stats</title>
<style>
:root{--bg:#0d1408;--bg-2:#16240d;--panel:rgba(16,28,10,.92);--slime:#7dff3c;--gold:#ffc63c;--beige:#f0e4c8;--ink:#e7ffd8;--muted:#9bbd83;--border:rgba(125,255,60,.28)}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px 64px;color:var(--ink);font-family:ui-monospace,"SFMono-Regular","Courier New",monospace;
background:radial-gradient(circle at 20% 0%,#26401356 0%,transparent 55%),linear-gradient(180deg,var(--bg) 0%,var(--bg-2) 100%);background-attachment:fixed;min-height:100vh}
.wrap{max-width:900px;margin:0 auto}
h1{color:var(--beige);letter-spacing:.06em;font-size:clamp(1.3rem,4vw,2rem);margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 28px;font-size:.85rem}
section{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:20px}
h2{color:var(--slime);font-size:.95rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px}
h3{color:var(--gold);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{color:var(--muted);text-align:left;font-weight:400;border-bottom:1px solid var(--border);padding:6px 8px}
td{padding:6px 8px;border-bottom:1px solid rgba(125,255,60,.1)}
.n{text-align:right;font-variant-numeric:tabular-nums}
tfoot td{color:var(--beige);font-weight:700;border-top:1px solid var(--border);border-bottom:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:620px){.cols{grid-template-columns:1fr}}
.muted{color:var(--muted);font-size:.85rem;margin:0}
.err{color:#ff8b6b;font-size:.85rem;margin:0}
.scroll{overflow-x:auto;margin-top:12px;max-height:520px;overflow-y:auto}
.scroll thead th{position:sticky;top:0;background:#101c0a;z-index:1}
.host{color:var(--gold);word-break:break-all}
.ip{color:var(--beige);font-size:.78rem;word-break:break-all}
.ts{color:var(--muted);white-space:nowrap}
footer{color:var(--muted);font-size:.75rem;text-align:center;margin-top:28px;line-height:1.7}
a{color:var(--slime)}
</style>
</head>
<body>
<div class="wrap">
  <h1>IP GOBLIN STATS</h1>
  <p class="sub">${esc(zoneName)} &middot; generated ${esc(stats.generated)}</p>
  ${section(`Traffic, last ${MAX_DAYS} days`, renderDaily(stats.daily))}
  ${section('Last 24 hours', renderBreakdown(stats.breakdown))}
  ${section('Visitor stream, last 24 hours', renderVisitors(stats.visitors))}
  ${section('API worker, last 24 hours', renderWorker(stats.worker))}
  <footer>
    Aggregate counts from Cloudflare's edge. No tracking code runs on the site
    and no visitor data is stored.<br>
    Hostnames come from live reverse-DNS lookups on the top ${PTR_LIMIT} visitors;
    most residential addresses have none.<br>
    A good share of non-US traffic is bots and scanners rather than people.
  </footer>
</div>
</body>
</html>`;
}

/* ---------- entrypoint ---------- */

function unauthorized() {
  return new Response('The goblins require a password.\n', {
    status: 401,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('The goblins only answer GET requests.\n', {
        status: 405,
        headers: { ...SECURITY_HEADERS, allow: 'GET, HEAD' },
      });
    }

    if (!env.STATS_PASSWORD || !env.CF_API_TOKEN) {
      return new Response(
        'Not configured yet. Set the STATS_PASSWORD and CF_API_TOKEN secrets.\n',
        { status: 503, headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    if (!authorized(request, env.STATS_PASSWORD)) return unauthorized();

    const url = new URL(request.url);
    const stats = await collect(env);

    if (url.searchParams.get('format') === 'json' || url.pathname === '/stats.json') {
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(page(stats, env.ZONE_NAME), {
      headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
