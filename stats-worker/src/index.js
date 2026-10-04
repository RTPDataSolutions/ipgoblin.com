/**
 * stats.ipgoblin.com — a password-protected traffic dashboard.
 *
 * Cloudflare already counts every request it proxies, so this reads those
 * aggregates back out of the GraphQL analytics API. Nothing is tracked on the
 * site itself and no visitor data is stored here.
 *
 * Two pages sit behind the same password:
 *
 *   /        the dashboard: traffic, visitors, and how calls are being made
 *   /calls   the call explorer: any slice of the calls, down to the single
 *            request, e.g. /calls?ip=203.0.113.9 or /calls?host=api.ipgoblin.com
 *
 * Add ?format=json to either one for the raw numbers.
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

/** The window behind the dashboard's detailed sections. */
const DAY_HOURS = 24;

/**
 * How far back the call explorer can look. On the free plan the request-level
 * datasets answer for up to 30 days, although the daily one stops at 7.
 */
const WINDOWS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
const DEFAULT_WINDOW = '24h';

/** Raw grouped rows pulled per visitor pass, before deduplication. */
const VISITOR_ROWS = 2000;
const RECENT_ROWS = 500;

/**
 * Visitors rendered, and how many of those get a reverse-DNS lookup. The
 * dashboard spends 8 GraphQL calls plus these lookups, and the free plan
 * allows 50 subrequests per request.
 */
const VISITOR_LIMIT = 120;
const PTR_LIMIT = 36;
const PTR_CONCURRENCY = 12;
const PTR_TIMEOUT_MS = 2000;

/** Calls listed one by one on the dashboard, and per page of the explorer. */
const LATEST_CALLS = 25;
const CALLS_PER_PAGE = 200;

/**
 * Single requests read to put a network (ASN) against each client IP.
 * Cloudflare exposes the ASN on individual requests but not on grouped counts.
 */
const NETWORK_ROWS = 10000;
const EXPLORER_NETWORK_ROWS = 2000;

/** Security events read to say which rule stopped a call. */
const SECURITY_ROWS = 2000;

/** Top callers on an explorer page, and how many of those get reverse DNS. */
const CALLER_LIMIT = 15;
const CALLER_PTR_LIMIT = 10;

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

/* ---------- call queries ---------- */

/**
 * Everything the call explorer can filter on: URL parameter -> dataset field.
 * Each field is readable on both the raw and the grouped request datasets on
 * the free plan, so one filter object drives both. `fw` names the same field
 * on the security-events dataset, where it has one.
 */
const FILTERS = {
  ip: { field: 'clientIP', fw: 'clientIP', label: 'IP' },
  host: { field: 'clientRequestHTTPHost', fw: 'clientRequestHTTPHost', label: 'host' },
  path: { field: 'clientRequestPath', fw: 'clientRequestPath', label: 'path' },
  method: { field: 'clientRequestHTTPMethodName', fw: 'clientRequestHTTPMethodName', label: 'method' },
  status: { field: 'edgeResponseStatus', fw: 'edgeResponseStatus', label: 'status', numeric: true },
  protocol: { field: 'clientRequestHTTPProtocol', fw: 'clientRequestHTTPProtocol', label: 'HTTP' },
  tls: { field: 'clientSSLProtocol', label: 'TLS' },
  type: { field: 'edgeResponseContentTypeName', label: 'content' },
  cache: { field: 'cacheStatus', label: 'cache' },
  action: { field: 'securityAction', fw: 'action', label: 'security' },
  source: { field: 'securitySource', fw: 'source', label: 'security source' },
  country: { field: 'clientCountryName', fw: 'clientCountryName', label: 'country' },
  device: { field: 'clientDeviceType', label: 'device' },
  browser: { field: 'userAgentBrowser', label: 'browser' },
  os: { field: 'userAgentOS', label: 'OS' },
  bot: { field: 'verifiedBotCategory', fw: 'verifiedBotCategory', label: 'verified bot' },
  agent: { field: 'userAgent', fw: 'userAgent', label: 'user agent' },
};
const FILTER_KEYS = Object.keys(FILTERS);

/**
 * How the calls are being made: one grouped pass per breakdown, all sent in a
 * single GraphQL round trip. `filter` lists the explorer parameter each
 * dimension drills into; breakdowns without one are on fields the raw dataset
 * cannot filter by. `explorer` ones are left off the dashboard, which already
 * has its own visitor, host and country sections.
 */
const BREAKDOWNS = [
  {
    key: 'calls', title: 'Top calls', limit: 20, wide: true,
    dims: ['clientRequestHTTPMethodName', 'clientRequestHTTPHost', 'clientRequestPath', 'edgeResponseStatus'],
    filter: ['method', 'host', 'path', 'status'],
  },
  {
    key: 'callers', title: 'Top callers', limit: CALLER_LIMIT, wide: true, explorer: true,
    dims: ['clientIP', 'clientCountryName'], filter: ['ip', null],
  },
  { key: 'hosts', title: 'Host', limit: 10, explorer: true, dims: ['clientRequestHTTPHost'], filter: ['host'] },
  { key: 'countries', title: 'Country', limit: 10, explorer: true, dims: ['clientCountryName'], filter: ['country'] },
  { key: 'methods', title: 'Method', limit: 8, dims: ['clientRequestHTTPMethodName'], filter: ['method'] },
  { key: 'statuses', title: 'Status', limit: 12, dims: ['edgeResponseStatus'], filter: ['status'] },
  { key: 'protocols', title: 'HTTP version', limit: 6, dims: ['clientRequestHTTPProtocol'], filter: ['protocol'] },
  { key: 'tls', title: 'TLS', limit: 6, dims: ['clientSSLProtocol'], filter: ['tls'] },
  { key: 'kex', title: 'TLS key exchange', limit: 6, dims: ['clientTLSKeyExchangeGroup'] },
  { key: 'types', title: 'Content type', limit: 10, dims: ['edgeResponseContentTypeName'], filter: ['type'] },
  { key: 'cache', title: 'Cache', limit: 8, dims: ['cacheStatus'], filter: ['cache'] },
  {
    key: 'security', title: 'Security', limit: 8,
    dims: ['securityAction', 'securitySource'], filter: ['action', 'source'],
  },
  { key: 'browsers', title: 'Browser', limit: 10, dims: ['userAgentBrowser'], filter: ['browser'] },
  { key: 'oses', title: 'Operating system', limit: 8, dims: ['userAgentOS'], filter: ['os'] },
  { key: 'devices', title: 'Device', limit: 4, dims: ['clientDeviceType'], filter: ['device'] },
  { key: 'bots', title: 'Verified bots', limit: 8, dims: ['verifiedBotCategory'], filter: ['bot'] },
  { key: 'colos', title: 'Cloudflare edge', limit: 10, dims: ['coloCode'] },
  { key: 'agents', title: 'User agents', limit: 12, wide: true, dims: ['userAgent'], filter: ['agent'] },
];
const BREAKDOWN = Object.fromEntries(BREAKDOWNS.map((b) => [b.key, b]));

// Cloudflare refuses a request with more than about 50 of these nodes.
function summaryQuery(breakdowns) {
  const nodes = breakdowns.map(
    (b) =>
      `${b.key}:httpRequestsAdaptiveGroups(limit:${b.limit},orderBy:[count_DESC],filter:$filter){count dimensions{${b.dims.join(' ')}}}`
  );
  return `query($zone:String!,$filter:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!){
  viewer{zones(filter:{zoneTag:$zone}){
    total:httpRequestsAdaptiveGroups(limit:1,filter:$filter){count sum{edgeResponseBytes} avg{sampleInterval}}
    ${nodes.join('\n    ')}
  }}
}`;
}

const DASHBOARD_SUMMARY_QUERY = summaryQuery(BREAKDOWNS.filter((b) => !b.explorer));
const EXPLORER_SUMMARY_QUERY = summaryQuery(BREAKDOWNS);

// Everything the raw dataset will say about a single call on the free plan.
const CALL_FIELDS = `datetime clientIP clientCountryName clientDeviceType clientAsn clientASNDescription
      clientRequestScheme clientRequestHTTPHost clientRequestHTTPMethodName clientRequestHTTPProtocol
      clientRequestPath clientRequestQuery clientSSLProtocol edgeResponseStatus
      edgeResponseContentTypeName cacheStatus originResponseStatus originResponseDurationMs
      securityAction securitySource verifiedBotCategory userAgent userAgentBrowser userAgentOS`;

const NETWORK_FIELDS = 'clientIP clientAsn clientASNDescription';

// The newest calls, minus this dashboard's own host so that reading the page
// does not fill the list, and a light pass mapping client IPs to networks.
const DASHBOARD_CALLS_QUERY = `query($zone:String!,$filter:ZoneHttpRequestsAdaptiveFilter_InputObject!,$latest:ZoneHttpRequestsAdaptiveFilter_InputObject!){
  viewer{zones(filter:{zoneTag:$zone}){
    latest:httpRequestsAdaptive(limit:${LATEST_CALLS},orderBy:[datetime_DESC],filter:$latest){${CALL_FIELDS}}
    networks:httpRequestsAdaptive(limit:${NETWORK_ROWS},filter:$filter){${NETWORK_FIELDS}}
  }}
}`;

// One page of calls, with one extra row to tell whether an older page exists,
// the first and last call in the window, and networks for the top callers.
// A page about a single IP gets its network from the calls themselves.
function explorerCallsQuery(withNetworks) {
  const networks = withNetworks
    ? `networks:httpRequestsAdaptive(limit:${EXPLORER_NETWORK_ROWS},filter:$filter){${NETWORK_FIELDS}}`
    : '';
  return `query($zone:String!,$filter:ZoneHttpRequestsAdaptiveFilter_InputObject!,$page:ZoneHttpRequestsAdaptiveFilter_InputObject!){
  viewer{zones(filter:{zoneTag:$zone}){
    calls:httpRequestsAdaptive(limit:${CALLS_PER_PAGE + 1},orderBy:[datetime_DESC],filter:$page){${CALL_FIELDS}}
    first:httpRequestsAdaptive(limit:1,orderBy:[datetime_ASC],filter:$filter){datetime}
    last:httpRequestsAdaptive(limit:1,orderBy:[datetime_DESC],filter:$filter){datetime}
    ${networks}
  }}
}`;
}

const EXPLORER_CALLS_QUERY = explorerCallsQuery(true);
const EXPLORER_IP_CALLS_QUERY = explorerCallsQuery(false);

const SECURITY_FIELDS = `datetime clientIP clientRequestHTTPHost clientRequestHTTPMethodName clientRequestPath
      clientRequestQuery action source description ruleId rayName sampleInterval`;

// Security events name the rule that fired, which the request datasets do not.
const SECURITY_QUERY = `query($zone:String!,$filter:ZoneFirewallEventsAdaptiveFilter_InputObject!){
  viewer{zones(filter:{zoneTag:$zone}){
    events:firewallEventsAdaptive(limit:${SECURITY_ROWS},orderBy:[datetime_DESC],filter:$filter){${SECURITY_FIELDS}}
  }}
}`;

// An older page of calls also needs the events from its own stretch of time,
// which the newest events of the whole window may not reach back to.
const SECURITY_PAGED_QUERY = `query($zone:String!,$filter:ZoneFirewallEventsAdaptiveFilter_InputObject!,$page:ZoneFirewallEventsAdaptiveFilter_InputObject!){
  viewer{zones(filter:{zoneTag:$zone}){
    events:firewallEventsAdaptive(limit:${SECURITY_ROWS},orderBy:[datetime_DESC],filter:$filter){${SECURITY_FIELDS}}
    page:firewallEventsAdaptive(limit:${SECURITY_ROWS},orderBy:[datetime_DESC],filter:$page){${SECURITY_FIELDS}}
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
async function resolveHostnames(visitors, limit = PTR_LIMIT) {
  const targets = visitors.slice(0, limit);
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
  // something, rather than the boilerplate every agent copies. URLs are
  // skipped, since their paths look like tokens ("r/1").
  const token = ua
    .replace(/\bhttps?:\/\/\S+/gi, '')
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
function buildVisitors(rows, recent, networks) {
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
    .map((v) => {
      const net = networks.get(v.ip);
      return {
        ip: v.ip,
        hits: v.hits,
        paths: v.paths.size,
        country: topKey(v.countries),
        device: topKey(v.devices),
        agent: uaLabel(topKey(v.agents)),
        asn: net ? net.asn : null,
        network: net ? net.name : null,
        hostname: null,
        lastSeen: v.lastSeen,
      };
    })
    .sort((a, b) => b.hits - a.hits)
    .slice(0, VISITOR_LIMIT);
}

function bump(map, key, by) {
  if (key === null || key === undefined || key === '') return;
  map.set(key, (map.get(key) || 0) + by);
}

/* ---------- calls ---------- */

class BadRequest extends Error {}

const MAX_FILTER_LENGTH = 2048;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Reads the explorer's filters, window and page from the query string. */
function parseExplorer(params) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    if (value.length > MAX_FILTER_LENGTH) throw new BadRequest(`The ${key} filter is too long.`);
    if (FILTERS[key].numeric) {
      if (!/^\d{1,3}$/.test(value)) throw new BadRequest(`The ${key} filter must be a number.`);
      filters[key] = Number(value);
    } else {
      filters[key] = value;
    }
  }

  const windowKey = params.get('window') || DEFAULT_WINDOW;
  if (!Object.hasOwn(WINDOWS, windowKey)) {
    throw new BadRequest(`The window must be one of ${Object.keys(WINDOWS).join(', ')}.`);
  }

  const before = params.get('before');
  if (before !== null && !TIMESTAMP.test(before)) {
    throw new BadRequest('before must be a UTC timestamp such as 2026-01-31T23:59:59Z.');
  }

  return { filters, windowKey, before };
}

function requestFilter(filters, from, to) {
  const filter = { datetime_geq: from, datetime_lt: to };
  for (const [key, value] of Object.entries(filters)) filter[FILTERS[key].field] = value;
  return filter;
}

/**
 * The same filter for the security-events dataset. `exact` is false when part
 * of it has no equivalent there, so the events cover a wider set of calls.
 */
function securityFilter(filters, from, to) {
  const filter = { datetime_geq: from, datetime_lt: to };
  let exact = true;
  for (const [key, value] of Object.entries(filters)) {
    const field = FILTERS[key].fw;
    if (field) filter[field] = value;
    else exact = false;
  }
  return { filter, exact };
}

/** client IP -> { asn, name }, from a pass over single requests. */
function networkMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r.clientIP && !map.has(r.clientIP)) {
      map.set(r.clientIP, { asn: r.clientAsn || null, name: r.clientASNDescription || null });
    }
  }
  return map;
}

/** The networks behind the traffic, ranked by how many distinct IPs each sent. */
function topNetworks(rows, limit = 12) {
  const byAsn = new Map();
  const everyone = new Set();
  for (const r of rows) {
    const asn = r.clientAsn || '';
    let n = byAsn.get(asn);
    if (!n) {
      n = { asn, name: r.clientASNDescription || null, ips: new Set() };
      byAsn.set(asn, n);
    }
    n.ips.add(r.clientIP);
    everyone.add(r.clientIP);
  }

  const list = [...byAsn.values()]
    .map((n) => ({ asn: n.asn || null, name: n.name, visitors: n.ips.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, limit);

  return { visitors: everyone.size, list };
}

/** Did Cloudflare's security act on this call (block, challenge, log...)? */
function actedOn(call) {
  return Boolean(call.securityAction) && call.securityAction !== 'unknown';
}

// The query string and the action are part of the key so that a call that got
// through is never matched to a sibling blocked in the same second.
function callKey(time, ip, method, host, path, query, action) {
  return [time, ip, method, host, path, query, action].join('|');
}

/** Tallies the security rules that fired. */
function tallyRules(events) {
  if (events.error) return { error: events.error };

  const tally = new Map();
  for (const e of events) {
    const id = `${e.action}|${e.source}|${e.ruleId}`;
    let rule = tally.get(id);
    if (!rule) {
      rule = { action: e.action, source: e.source, description: e.description, ruleId: e.ruleId, count: 0 };
      tally.set(id, rule);
    }
    // Each kept event stands in for sampleInterval real ones.
    rule.count += e.sampleInterval || 1;
  }

  return {
    rules: [...tally.values()].sort((a, b) => b.count - a.count),
    // Hitting the row cap means the tally only covers the newest events.
    partial: events.length >= SECURITY_ROWS,
  };
}

/** Indexes security events by the call they acted on, so that call can name its rule. */
function indexEvents(events) {
  const byCall = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    const key = callKey(
      e.datetime, e.clientIP, e.clientRequestHTTPMethodName, e.clientRequestHTTPHost,
      e.clientRequestPath, e.clientRequestQuery, e.action
    );
    const list = byCall.get(key);
    if (list) list.push(e);
    else byCall.set(key, [e]);
  }
  return byCall;
}

/** Flattens a raw request row into the shape the pages and the JSON share. */
function shapeCall(row, events) {
  // Each event is handed out once, so identical calls in the same second each
  // get their own ray ID rather than sharing one.
  const event = actedOn(row)
    ? events
        .get(
          callKey(
            row.datetime, row.clientIP, row.clientRequestHTTPMethodName, row.clientRequestHTTPHost,
            row.clientRequestPath, row.clientRequestQuery, row.securityAction
          )
        )
        ?.shift()
    : undefined;

  return {
    time: row.datetime,
    ip: row.clientIP,
    country: row.clientCountryName,
    asn: row.clientAsn || null,
    network: row.clientASNDescription || null,
    device: row.clientDeviceType,
    method: row.clientRequestHTTPMethodName,
    scheme: row.clientRequestScheme,
    host: row.clientRequestHTTPHost,
    path: row.clientRequestPath,
    query: row.clientRequestQuery,
    protocol: row.clientRequestHTTPProtocol,
    tls: row.clientSSLProtocol,
    status: row.edgeResponseStatus,
    contentType: row.edgeResponseContentTypeName,
    cache: row.cacheStatus,
    originStatus: row.originResponseStatus,
    originMs: row.originResponseDurationMs,
    securityAction: row.securityAction,
    securitySource: row.securitySource,
    verifiedBot: row.verifiedBotCategory,
    userAgent: row.userAgent,
    browser: row.userAgentBrowser,
    os: row.userAgentOS,
    agent: row.userAgent ? uaLabel(row.userAgent) : 'no user agent',
    rule: event
      ? {
          action: event.action,
          source: event.source,
          description: event.description,
          ruleId: event.ruleId,
          rayId: event.rayName,
        }
      : null,
  };
}

/**
 * Totals for a summary pass. Counts are Cloudflare's estimates, scaled up from
 * the requests it kept; `kept` is how many it stored one by one, which is what
 * a call list can show.
 */
function shapeSummary(zone) {
  const { total, ...breakdowns } = zone;
  const t = total[0];
  const calls = t ? t.count : 0;
  const interval = t && t.avg ? t.avg.sampleInterval : 0;
  return {
    total: {
      calls,
      bytes: t ? t.sum.edgeResponseBytes : 0,
      kept: interval ? Math.round(calls / interval) : calls,
    },
    ...breakdowns,
  };
}

/**
 * Cuts one page from newest-first rows fetched one past the page size. Pages
 * are cut by time, which is only kept to the second, so a second straddling
 * the cut is held back whole for the next page rather than split, which would
 * lose the part that did not fit.
 */
function pageOf(rows) {
  if (rows.length <= CALLS_PER_PAGE) return { shown: rows, older: null };

  const edge = rows[CALLS_PER_PAGE].datetime;
  const whole = rows.slice(0, CALLS_PER_PAGE).filter((r) => r.datetime !== edge);
  // More kept calls in one second than fit on a page: time cannot split them.
  if (!whole.length) return { shown: rows.slice(0, CALLS_PER_PAGE), older: edge };

  return { shown: whole, older: nextSecond(edge) };
}

function nextSecond(t) {
  return `${new Date(Date.parse(t) + 1000).toISOString().slice(0, 19)}Z`;
}

/** Everything behind one call-explorer page. */
async function collectCalls(env, { filters, windowKey, before }) {
  const zone = env.ZONE_ID;
  const token = env.CF_API_TOKEN;

  const from = isoTime(WINDOWS[windowKey]);
  const to = isoTime(0);
  const filter = requestFilter(filters, from, to);
  // Paging walks back through the call list; the breakdowns always cover the
  // whole window.
  const paged = before !== null && before < to;
  const page = paged ? { ...filter, datetime_lt: before } : filter;
  const fw = securityFilter(filters, from, to);
  const oneIP = Object.hasOwn(filters, 'ip');

  const [summary, raw, security, hostname] = await Promise.all([
    graphql(token, EXPLORER_SUMMARY_QUERY, { zone, filter })
      .then((d) => shapeSummary(d.viewer.zones[0]))
      .catch((e) => ({ error: e.message })),
    graphql(token, oneIP ? EXPLORER_IP_CALLS_QUERY : EXPLORER_CALLS_QUERY, { zone, filter, page })
      .then((d) => d.viewer.zones[0])
      .catch((e) => ({ error: e.message })),
    (paged
      ? graphql(token, SECURITY_PAGED_QUERY, { zone, filter: fw.filter, page: { ...fw.filter, datetime_lt: before } })
      : graphql(token, SECURITY_QUERY, { zone, filter: fw.filter })
    )
      .then((d) => d.viewer.zones[0])
      .catch((e) => ({ error: e.message })),
    oneIP ? lookupPTR(filters.ip) : null,
  ]);

  const rules = tallyRules(security.error ? security : security.events);
  const events = indexEvents(security.error ? [] : security.page || security.events);
  const rows = raw.error ? [] : raw.calls;
  const { shown, older } = pageOf(rows);
  const calls = raw.error ? { error: raw.error } : shown.map((r) => shapeCall(r, events));
  const networks = networkMap(raw.error ? [] : raw.networks || rows);

  let callers = [];
  if (!summary.error) {
    callers = summary.callers.map((r) => {
      const ip = r.dimensions.clientIP;
      const net = networks.get(ip);
      return {
        ip,
        country: r.dimensions.clientCountryName,
        calls: r.count,
        asn: net ? net.asn : null,
        network: net ? net.name : null,
        hostname: oneIP && ip === filters.ip ? hostname : null,
      };
    });
    delete summary.callers;
    if (!oneIP) await resolveHostnames(callers, CALLER_PTR_LIMIT);
  }

  let visitor = null;
  if (oneIP) {
    const net = networks.get(filters.ip);
    visitor = {
      ip: filters.ip,
      hostname,
      asn: net ? net.asn : null,
      network: net ? net.name : null,
      country: callers.length ? callers[0].country : null,
    };
  }

  return {
    window: windowKey,
    from,
    to,
    before: paged ? before : null,
    filters,
    visitor,
    summary,
    callers,
    first: raw.error || !raw.first.length ? null : raw.first[0].datetime,
    last: raw.error || !raw.last.length ? null : raw.last[0].datetime,
    calls,
    // Where the next, older page starts.
    older,
    security: rules.error
      ? { error: rules.error }
      : { exact: fw.exact, partial: rules.partial, rules: rules.rules },
    generated: new Date().toISOString(),
  };
}

async function collect(env, selfHost) {
  const zone = env.ZONE_ID;
  const account = env.ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  const from = isoTime(DAY_HOURS);
  const to = isoTime(0);
  const span = { datetime_geq: from, datetime_lt: to };

  // One round trip each, in parallel. A single failure should not blank the
  // whole page, so each section degrades on its own.
  const [daily, breakdown, worker, visitorRows, recentRows, summary, calls, events] = await Promise.all([
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
    graphql(token, DASHBOARD_SUMMARY_QUERY, { zone, filter: span })
      .then((d) => shapeSummary(d.viewer.zones[0]))
      .catch((e) => ({ error: e.message })),
    graphql(token, DASHBOARD_CALLS_QUERY, {
      zone,
      filter: span,
      latest: { ...span, clientRequestHTTPHost_neq: selfHost },
    })
      .then((d) => d.viewer.zones[0])
      .catch((e) => ({ error: e.message })),
    graphql(token, SECURITY_QUERY, { zone, filter: span })
      .then((d) => d.viewer.zones[0].events)
      .catch((e) => ({ error: e.message })),
  ]);

  const visitors = buildVisitors(visitorRows, recentRows, networkMap(calls.error ? [] : calls.networks));
  if (!visitors.error) await resolveHostnames(visitors);

  const byCall = indexEvents(events);

  return {
    daily,
    breakdown,
    worker,
    visitors,
    calls: {
      summary,
      latest: calls.error ? { error: calls.error } : calls.latest.map((r) => shapeCall(r, byCall)),
      networks: calls.error ? { error: calls.error } : topNetworks(calls.networks),
      security: tallyRules(events),
    },
    generated: new Date().toISOString(),
  };
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

// toLocaleString builds a fresh formatter on every call, which adds up to
// milliseconds of CPU across a page with this many numbers on it.
const NUMBER = new Intl.NumberFormat('en-US');

function num(value) {
  return NUMBER.format(Number(value || 0));
}

function section(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

function errorBox(message) {
  return `<p class="err">Could not load: ${esc(message)}</p>`;
}

function clip(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function share(part, whole) {
  return whole ? Math.min(100, (part / whole) * 100) : 0;
}

function pct(part, whole) {
  const p = share(part, whole);
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

/** 2026-09-29T03:26:18Z -> 09-29 03:26:18 */
function shortTime(t) {
  return t ? `${t.slice(5, 10)} ${t.slice(11, 19)}` : '—';
}

function longTime(t) {
  return t ? `${t.slice(0, 10)} ${t.slice(11, 19)} UTC` : '—';
}

/**
 * A link into the call explorer. It keeps the page's filters and window and
 * applies `changes` on top, where null removes a filter. `fresh` starts from
 * no filters, for pivots such as "everything from this IP".
 */
function callsHref(ctx, changes = {}, { fresh = false, windowKey = ctx.windowKey, before = null } = {}) {
  const merged = { ...(fresh ? {} : ctx.filters), ...changes };
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = merged[key];
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  if (windowKey !== DEFAULT_WINDOW) params.set('window', windowKey);
  if (before) params.set('before', before);
  const qs = params.toString();
  return qs ? `/calls?${qs}` : '/calls';
}

/** A filter the explorer will accept, so it is safe to link to. */
function drillable(changes) {
  return Object.values(changes).every(
    (v) => v !== undefined && v !== null && String(v).length <= MAX_FILTER_LENGTH
  );
}

/** `text` as a link into the explorer when the filter allows it, plain otherwise. */
function drillLink(ctx, changes, text, options) {
  return changes && drillable(changes)
    ? `<a href="${esc(callsHref(ctx, changes, options))}">${text}</a>`
    : text;
}

const STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  413: 'Content Too Large',
  414: 'URI Too Long',
  429: 'Too Many Requests',
  499: 'Client Closed Request',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  520: 'Unknown Error',
  521: 'Web Server Is Down',
  522: 'Connection Timed Out',
  523: 'Origin Is Unreachable',
  524: 'A Timeout Occurred',
  525: 'SSL Handshake Failed',
  526: 'Invalid SSL Certificate',
};

function statusLabel(code) {
  const text = STATUS_TEXT[code];
  return text ? `${code} ${text}` : String(code);
}

function statusClass(code) {
  const c = Number(code);
  if (c >= 500) return 's5';
  if (c >= 400) return 's4';
  if (c >= 300) return 's3';
  return c >= 200 ? 's2' : 's0';
}

const SECURITY_SOURCES = {
  firewallManaged: 'managed rules',
  firewallCustom: 'custom rules',
  botFight: 'Bot Fight Mode',
  l7ddos: 'DDoS protection',
  rateLimit: 'rate limiting',
  securityLevel: 'security level',
  bic: 'browser integrity check',
  hot: 'hotlink protection',
};

function securityLabel(action, source) {
  if (!action || action === 'unknown') return 'none';
  const by = SECURITY_SOURCES[source] || source;
  return by && by !== 'unknown' ? `${action} by ${by}` : action;
}

function tlsLabel(value) {
  return value === 'none' ? 'none (plain HTTP)' : value || '?';
}

function kexLabel(value) {
  if (!value || value === 'NONE') return 'none (plain HTTP)';
  // The hybrid groups pair a classic curve with ML-KEM, which is built to
  // hold up against a future quantum computer.
  return /MLKEM|Kyber/i.test(value) ? `${value} (post-quantum)` : value;
}

function countryLabel(code) {
  return code ? `${flagEmoji(code)} ${code}`.trim() : '??';
}

function networkLabel(asn, name) {
  if (asn) return `AS${asn} ${name || ''}`.trim();
  return name || 'unknown';
}

/** How each breakdown's values read on the page. */
const LABELS = {
  statuses: (d) => statusLabel(d.edgeResponseStatus),
  tls: (d) => tlsLabel(d.clientSSLProtocol),
  kex: (d) => kexLabel(d.clientTLSKeyExchangeGroup),
  types: (d) => (d.edgeResponseContentTypeName === 'empty' ? 'empty (no body)' : d.edgeResponseContentTypeName),
  security: (d) => securityLabel(d.securityAction, d.securitySource),
  bots: (d) => d.verifiedBotCategory || 'not a verified bot',
  countries: (d) => countryLabel(d.clientCountryName),
  agents: (d) => d.userAgent || '(no user agent)',
};

function labelFor(b, dims) {
  const value = LABELS[b.key] ? LABELS[b.key](dims) : dims[b.dims[0]];
  return value === null || value === undefined || value === '' ? '(none)' : String(value);
}

/** The explorer filters a breakdown row drills into, or null where it cannot. */
function drillFor(b, dims) {
  if (!b.filter) return null;
  const changes = {};
  b.filter.forEach((key, i) => {
    if (key) changes[key] = dims[b.dims[i]];
  });
  return changes;
}

function methodBadge(method) {
  const m = String(method || '?');
  return `<span class="m${/^(GET|HEAD|OPTIONS)$/.test(m) ? '' : ' m-w'}">${esc(m)}</span>`;
}

function urlHTML(host, path, query) {
  return `<span class="h">${esc(host)}</span>${esc(path)}${query ? `<span class="q">${esc(query)}</span>` : ''}`;
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

function renderBreakdown(rows, ctx) {
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
    .map(([host, n]) => `<tr><td>${drillLink(ctx, { host }, esc(host))}</td><td class="n">${num(n)}</td></tr>`)
    .join('');

  const countryRows = sorted(byCountry)
    .slice(0, 15)
    .map(
      ([country, n]) =>
        `<tr><td>${drillLink(ctx, { country }, `${flagEmoji(country)} ${esc(country)}`)}</td><td class="n">${num(n)}</td></tr>`
    )
    .join('');

  return `<div class="cols">
    <div><h3>By hostname</h3><table><tbody>${hostRows}</tbody></table></div>
    <div><h3>By country</h3><table><tbody>${countryRows}</tbody></table></div>
  </div>`;
}

function renderWorker(rows, ctx) {
  const more = `<p class="more">${drillLink(ctx, { host: ctx.apiHost }, `Every call to ${esc(ctx.apiHost)}, and how it was made &rarr;`)}</p>`;
  if (rows.error) return errorBox(rows.error) + more;
  if (!rows.length) return `<p class="muted">No requests in the last 24 hours.</p>${more}`;

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
  </table>${more}`;
}

function renderVisitors(rows, ctx) {
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
        <td>${who}<br>${drillLink(ctx, { ip: r.ip }, `<span class="ip">${esc(r.ip)}</span>`)}</td>
        <td class="nw">${flagEmoji(r.country)} ${esc(r.country || '??')}</td>
        <td class="net">${esc(r.network || '—')}</td>
        <td>${esc(r.agent)}</td>
        <td>${esc(r.device || '?')}</td>
        <td class="n">${num(r.hits)}</td>
        <td class="n">${num(r.paths)}</td>
        <td class="ts">${esc(r.lastSeen ? r.lastSeen.slice(11, 16) + ' UTC' : '—')}</td>
      </tr>`;
    })
    .join('');

  return `<p class="muted">${num(rows.length)} unique visitors &middot; ${num(repeat)} came back for more
    &middot; ${num(named)} gave up a hostname &middot; click an IP for every call it made</p>
  <div class="scroll"><table>
    <thead><tr>
      <th>Host / IP</th><th>From</th><th>Network</th><th>Agent</th><th>Device</th>
      <th class="n">Hits</th><th class="n">Paths</th><th>Last</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

/* ---------- rendering: calls ---------- */

function renderTotals(total) {
  const ratio = total.kept ? total.calls / total.kept : 1;
  const sampled = ratio > 1.05;
  const kept = sampled
    ? `<span><b>${num(total.kept)}</b> kept one by one, about 1 in ${esc(ratio.toFixed(1))}</span>`
    : '<span>every one kept individually</span>';
  return `<p class="stats">
    <span><b>${sampled ? '~' : ''}${num(total.calls)}</b> calls</span>
    ${kept}
    <span><b>${esc(mb(total.bytes))}</b> sent back</span>
  </p>`;
}

function renderCard(b, rows, total, ctx) {
  if (!rows.length) {
    return `<div class="card"><h3>${esc(b.title)}</h3><p class="muted">None.</p></div>`;
  }

  const body = rows
    .map((r) => {
      const label = drillLink(ctx, drillFor(b, r.dimensions), esc(labelFor(b, r.dimensions)));
      return `<tr>
        <td class="lbl">${label}<span class="bar" style="width:${share(r.count, total).toFixed(1)}%"></span></td>
        <td class="n">${num(r.count)}</td>
        <td class="n pct">${esc(pct(r.count, total))}</td>
      </tr>`;
    })
    .join('');

  return `<div class="card"><h3>${esc(b.title)}</h3><table class="mini"><tbody>${body}</tbody></table></div>`;
}

/** The small breakdowns, as a grid of cards. `extra` is appended to the grid. */
function renderCards(summary, ctx, extra = '') {
  const cards = BREAKDOWNS.filter((b) => !b.wide && Array.isArray(summary[b.key]))
    .map((b) => renderCard(b, summary[b.key], summary.total.calls, ctx))
    .join('');
  return `<div class="grid">${cards}${extra}</div>`;
}

function renderTopCalls(rows, total, ctx) {
  if (!rows.length) return '';

  const body = rows
    .map((r) => {
      const d = r.dimensions;
      const call = drillLink(ctx, drillFor(BREAKDOWN.calls, d), urlHTML(d.clientRequestHTTPHost, d.clientRequestPath));
      return `<tr>
        <td>${methodBadge(d.clientRequestHTTPMethodName)}</td>
        <td class="u">${call}</td>
        <td><span class="st ${statusClass(d.edgeResponseStatus)}" title="${esc(statusLabel(d.edgeResponseStatus))}">${esc(d.edgeResponseStatus)}</span></td>
        <td class="n">${num(r.count)}</td>
        <td class="n pct">${esc(pct(r.count, total))}</td>
      </tr>`;
    })
    .join('');

  return `<h3 class="gap">Top calls</h3>
  <div class="scroll"><table>
    <thead><tr><th>Method</th><th>Call</th><th>Status</th><th class="n">Calls</th><th class="n">Share</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderCallers(callers, total, ctx) {
  if (!callers.length) return '';

  const body = callers
    .map((c) => {
      const who = c.hostname
        ? `<span class="host">${esc(c.hostname)}</span>`
        : '<span class="muted">no reverse DNS</span>';
      return `<tr>
        <td class="who">${drillLink(ctx, { ip: c.ip }, `<span class="ip">${esc(c.ip)}</span>`)}<br>${who}</td>
        <td class="nw">${esc(countryLabel(c.country))}</td>
        <td class="net">${esc(c.network || '—')}</td>
        <td class="n">${num(c.calls)}</td>
        <td class="n pct">${esc(pct(c.calls, total))}</td>
      </tr>`;
    })
    .join('');

  return `<h3 class="gap">Top callers</h3>
  <div class="scroll"><table>
    <thead><tr><th>IP / host</th><th>From</th><th>Network</th><th class="n">Calls</th><th class="n">Share</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderAgents(rows, total, ctx) {
  if (!rows.length) return '';

  const b = BREAKDOWN.agents;
  const body = rows
    .map((r) => {
      const label = drillLink(ctx, drillFor(b, r.dimensions), esc(labelFor(b, r.dimensions)));
      return `<tr>
        <td class="ua">${label} <span class="muted">&rarr; ${esc(uaLabel(r.dimensions.userAgent))}</span></td>
        <td class="n">${num(r.count)}</td>
        <td class="n pct">${esc(pct(r.count, total))}</td>
      </tr>`;
    })
    .join('');

  return `<h3 class="gap">User agents</h3>
  <div class="scroll"><table>
    <thead><tr><th>Sent as</th><th class="n">Calls</th><th class="n">Share</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderNetworks(networks) {
  const head = '<h3>Networks</h3>';
  if (networks.error) return `<div class="card">${head}${errorBox(networks.error)}</div>`;
  if (!networks.list.length) return `<div class="card">${head}<p class="muted">None.</p></div>`;

  const body = networks.list
    .map(
      (n) => `<tr>
        <td class="lbl">${esc(networkLabel(n.asn, n.name))}<span class="bar" style="width:${share(n.visitors, networks.visitors).toFixed(1)}%"></span></td>
        <td class="n">${num(n.visitors)}</td>
      </tr>`
    )
    .join('');

  return `<div class="card">${head}<table class="mini"><tbody>${body}</tbody></table>
    <p class="muted tiny">distinct IPs from each network</p></div>`;
}

function renderRules(security, note = '') {
  if (security.error) return errorBox(security.error);
  if (!security.rules.length) return `${note}<p class="muted">No security rules fired.</p>`;

  const partial = security.partial
    ? `<p class="muted">Counted from the newest ${num(SECURITY_ROWS)} security events only.</p>`
    : '';
  const body = security.rules
    .map(
      (r) => `<tr>
        <td class="blk">${esc(securityLabel(r.action, r.source))}</td>
        <td>${esc(r.description || r.ruleId || '?')}</td>
        <td class="n">${num(r.count)}</td>
      </tr>`
    )
    .join('');

  return `${note}${partial}<div class="scroll"><table>
    <thead><tr><th>Action</th><th>Rule</th><th class="n">Calls</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

/**
 * The request as it reached Cloudflare's edge, as far as the analytics record
 * it: the request line (or HTTP/2 and HTTP/3 pseudo-headers), the host and the
 * user agent. Other headers and any body are not kept.
 */
function requestText(c) {
  const target = `${c.path}${c.query || ''}`;
  if (/^HTTP\/[23]/.test(c.protocol)) {
    return [
      `:method: ${c.method}`,
      `:scheme: ${c.scheme}`,
      `:authority: ${c.host}`,
      `:path: ${target}`,
      c.userAgent ? `user-agent: ${c.userAgent}` : '(no user-agent)',
    ].join('\n');
  }
  return [
    `${c.method} ${target} ${c.protocol || 'HTTP/1.1'}`,
    `Host: ${c.host}`,
    c.userAgent ? `User-Agent: ${c.userAgent}` : '(no User-Agent)',
  ].join('\n');
}

function connectionLabel(c) {
  if (c.tls === 'none') return `plain ${c.scheme || 'http'} over ${c.protocol}, not encrypted`;
  return `${c.scheme || 'https'} over ${c.protocol}, ${c.tls}`;
}

function responseLabel(c) {
  const type = c.contentType === 'empty' ? 'no body' : c.contentType;
  return `${statusLabel(c.status)} · ${type} · cache ${c.cache}`;
}

function originLabel(c) {
  if (!c.originStatus) return 'not contacted: answered at the edge (Worker, cache, redirect or block)';
  return `${c.originStatus} in ${num(c.originMs)} ms`;
}

function ruleLabel(c) {
  if (c.rule) {
    const { action, source, description, ruleId, rayId } = c.rule;
    return `${securityLabel(action, source)}: ${description || ruleId} (ray ${rayId})`;
  }
  if (actedOn(c)) {
    return `${securityLabel(c.securityAction, c.securitySource)}; the rule was not among the sampled security events`;
  }
  return 'none';
}

/** A word on calls that are not what they look like. */
function callNote(c) {
  const path = c.path || '';
  if (path === '/cdn-cgi/rum') {
    return 'Cloudflare Web Analytics: a beacon the browser posts after a page loads, not something the visitor did.';
  }
  if (path.startsWith('/cdn-cgi/')) return 'One of Cloudflare’s own endpoints, answered at the edge.';
  return null;
}

function renderCallDetail(c, ctx) {
  const facts = [
    ['When', longTime(c.time)],
    ['From', [c.ip, countryLabel(c.country), c.device].filter(Boolean).join(' · ')],
    ['Network', networkLabel(c.asn, c.network)],
    ['Connection', connectionLabel(c)],
    ['Client', c.agent],
    ['Browser / OS', `${c.browser || '?'} / ${c.os || '?'}`],
    c.verifiedBot ? ['Verified bot', c.verifiedBot] : null,
    ['Response', responseLabel(c)],
    ['Origin', originLabel(c)],
    ['Security', ruleLabel(c)],
  ].filter(Boolean);

  const note = callNote(c);
  const fresh = { fresh: true };
  const links = [
    drillLink(ctx, { ip: c.ip }, `everything from ${esc(c.ip)}`, fresh),
    drillLink(
      ctx,
      { method: c.method, host: c.host, path: c.path },
      `every ${esc(c.method)} ${esc(clip(`${c.host}${c.path}`, 48))}`,
      fresh
    ),
    drillLink(ctx, { agent: c.userAgent }, c.userAgent ? 'this user agent' : 'calls with no user agent', fresh),
  ];

  return `<div class="detail">
      <pre class="req">${esc(requestText(c))}</pre>
      <dl class="kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <p class="drill">Drill into ${links.join(' &middot; ')}</p>
    </div>`;
}

function renderCall(c, ctx) {
  const meta = [
    `${flagEmoji(c.country)} ${esc(c.ip)}`,
    c.network ? esc(clip(c.network, 40)) : null,
    esc(`${c.protocol || '?'} · ${c.tls === 'none' ? 'no TLS' : c.tls || '?'}`),
    esc(c.agent),
    actedOn(c) ? `<span class="blk">${esc(securityLabel(c.securityAction, c.securitySource))}</span>` : null,
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return `<details class="call">
    <summary>
      <span class="t">${esc(shortTime(c.time))}</span>
      ${methodBadge(c.method)}
      <span class="u">${urlHTML(c.host, clip(c.path, 160), c.query ? clip(c.query, 80) : '')}</span>
      <span class="st ${statusClass(c.status)}" title="${esc(statusLabel(c.status))}">${esc(c.status)}</span>
      <span class="meta">${meta}</span>
    </summary>
    ${renderCallDetail(c, ctx)}
  </details>`;
}

function renderCallList(calls, ctx) {
  if (!calls.length) return '<p class="muted">No calls matched.</p>';
  return `<div class="calls">${calls.map((c) => renderCall(c, ctx)).join('')}</div>`;
}

/* ---------- rendering: dashboard ---------- */

function renderHow(calls, ctx) {
  const s = calls.summary;
  if (s.error) return errorBox(s.error);
  if (!s.total.calls) return '<p class="muted">No calls in the last 24 hours.</p>';

  return `${renderTotals(s.total)}
  ${renderTopCalls(s.calls, s.total.calls, ctx)}
  ${renderCards(s, ctx, renderNetworks(calls.networks))}
  ${renderAgents(s.agents, s.total.calls, ctx)}
  <p class="more">Every value above is a link into the <a href="${esc(callsHref(ctx))}">call explorer</a>,
    which breaks any slice down the same way and lists its calls one by one.</p>`;
}

function renderLatest(latest, ctx) {
  if (latest.error) return errorBox(latest.error);
  return `<p class="muted">The newest calls, leaving out this dashboard's own. Open one to see the
    request as it arrived and everything Cloudflare recorded about it.</p>
  ${renderCallList(latest, ctx)}
  <p class="more"><a href="${esc(callsHref(ctx))}">Every call in the explorer &rarr;</a></p>`;
}

function dashboardPage(stats, zoneName, ctx) {
  return layout(
    'IP Goblin stats',
    `${esc(zoneName)} &middot; generated ${esc(stats.generated)}`,
    `${section(`Traffic, last ${MAX_DAYS} days`, renderDaily(stats.daily))}
  ${section('Last 24 hours', renderBreakdown(stats.breakdown, ctx))}
  ${section('How calls are made, last 24 hours', renderHow(stats.calls, ctx))}
  ${section('Security rules that fired, last 24 hours', renderRules(stats.calls.security))}
  ${section('Visitor stream, last 24 hours', renderVisitors(stats.visitors, ctx))}
  ${section('Latest calls', renderLatest(stats.calls.latest, ctx))}
  ${section('API worker, last 24 hours', renderWorker(stats.worker, ctx))}`
  );
}

/* ---------- rendering: call explorer ---------- */

function renderExplorerNav(ctx) {
  const windows = Object.keys(WINDOWS)
    .map(
      (w) =>
        `<a class="chip${w === ctx.windowKey ? ' on' : ''}" href="${esc(callsHref(ctx, {}, { windowKey: w }))}">${esc(w)}</a>`
    )
    .join('');

  const active = FILTER_KEYS.filter((k) => Object.hasOwn(ctx.filters, k));
  const shown = (k, v) => {
    if (k === 'status') return statusLabel(v);
    if (k === 'country') return countryLabel(v);
    return v === '' ? '(empty)' : clip(v, 60);
  };
  const filters = active.length
    ? active
        .map(
          (k) =>
            `<a class="chip on" title="Remove this filter" href="${esc(callsHref(ctx, { [k]: null }))}">${esc(FILTERS[k].label)}: ${esc(shown(k, ctx.filters[k]))} &times;</a>`
        )
        .join('') + `<a class="chip" href="${esc(callsHref(ctx, {}, { fresh: true }))}">clear all</a>`
    : '<span class="muted">none yet &mdash; click any value below to narrow down</span>';

  return `<div class="navs">
    <nav class="chips"><a class="chip" href="/">&larr; dashboard</a><span class="lab">window</span>${windows}</nav>
    <nav class="chips"><span class="lab">filters</span>${filters}</nav>
  </div>`;
}

function renderVisitorCard(v) {
  const facts = [
    ['IP', v.ip],
    ['Reverse DNS', v.hostname || 'none'],
    ['Network', networkLabel(v.asn, v.network)],
    ['Country', countryLabel(v.country)],
  ];
  return `<dl class="kv visitor">${facts.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>`;
}

function renderExplorerSummary(data) {
  const parts = [];
  if (data.visitor) parts.push(renderVisitorCard(data.visitor));
  parts.push(data.summary.error ? errorBox(data.summary.error) : renderTotals(data.summary.total));
  if (data.first) {
    parts.push(
      `<p class="muted">First call ${esc(longTime(data.first))} &middot; latest ${esc(longTime(data.last))}</p>`
    );
  }
  return parts.join('');
}

function renderExplorerHow(data, ctx) {
  const s = data.summary;
  if (s.error) return errorBox(s.error);
  const total = s.total.calls;
  if (!total) return '<p class="muted">No calls matched in this window.</p>';

  return `${renderTopCalls(s.calls, total, ctx)}
  ${renderCallers(data.callers, total, ctx)}
  ${renderCards(s, ctx)}
  ${renderAgents(s.agents, total, ctx)}`;
}

function renderExplorerRules(data) {
  const s = data.security;
  const note =
    !s.error && !s.exact
      ? '<p class="muted">Cloudflare’s security events cannot be filtered on every field above, so this covers the wider set of calls matching the rest of the filters.</p>'
      : '';
  return renderRules(s, note);
}

function renderExplorerCalls(data, ctx) {
  if (data.calls.error) return errorBox(data.calls.error);

  const from = data.before ? `, from before ${esc(longTime(data.before))}` : '';
  const pager = [];
  if (data.before) pager.push(`<a href="${esc(callsHref(ctx))}">&larr; newest calls</a>`);
  if (data.older) pager.push(`<a href="${esc(callsHref(ctx, {}, { before: data.older }))}">older calls &rarr;</a>`);

  return `<p class="muted">Newest first${from}. Cloudflare keeps a sample of calls when traffic is busy, and
    these are the ones it kept. Open one to see the request as it arrived and everything recorded about it.</p>
  ${renderCallList(data.calls, ctx)}
  ${pager.length ? `<p class="more">${pager.join(' &middot; ')}</p>` : ''}`;
}

function explorerPage(data, zoneName, ctx) {
  return layout(
    'Calls · IP Goblin stats',
    `${esc(zoneName)} &middot; call explorer &middot; generated ${esc(data.generated)}`,
    `${renderExplorerNav(ctx)}
  ${section(`Summary, last ${ctx.windowKey}`, renderExplorerSummary(data))}
  ${section('How these calls were made', renderExplorerHow(data, ctx))}
  ${section('Security rules that fired', renderExplorerRules(data))}
  ${section('Calls', renderExplorerCalls(data, ctx))}`
  );
}

const CSS = `
:root{--bg:#0d1408;--bg-2:#16240d;--panel:rgba(16,28,10,.92);--slime:#7dff3c;--gold:#ffc63c;--beige:#f0e4c8;--ink:#e7ffd8;--muted:#9bbd83;--border:rgba(125,255,60,.28);--line:rgba(125,255,60,.1);--sky:#7ec8ff;--red:#ff8b6b}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px 64px;color:var(--ink);font-family:ui-monospace,"SFMono-Regular","Courier New",monospace;
background:radial-gradient(circle at 20% 0%,#26401356 0%,transparent 55%),linear-gradient(180deg,var(--bg) 0%,var(--bg-2) 100%);background-attachment:fixed;min-height:100vh}
.wrap{max-width:1040px;margin:0 auto}
h1{color:var(--beige);letter-spacing:.06em;font-size:clamp(1.3rem,4vw,2rem);margin:0 0 4px}
h1 a{color:inherit;text-decoration:none}
.sub{color:var(--muted);margin:0 0 28px;font-size:.85rem}
section{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:20px}
h2{color:var(--slime);font-size:.95rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px}
h3{color:var(--gold);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
h3.gap{margin-top:24px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{color:var(--muted);text-align:left;font-weight:400;border-bottom:1px solid var(--border);padding:6px 8px}
td{padding:6px 8px;border-bottom:1px solid var(--line)}
.n{text-align:right;font-variant-numeric:tabular-nums}
tfoot td{color:var(--beige);font-weight:700;border-top:1px solid var(--border);border-bottom:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:620px){.cols{grid-template-columns:1fr}}
.muted{color:var(--muted);font-size:.85rem;margin:0}
.err{color:var(--red);font-size:.85rem;margin:0}
.scroll{overflow-x:auto;margin-top:12px;max-height:520px;overflow-y:auto}
.scroll thead th{position:sticky;top:0;background:#101c0a;z-index:1}
.host{color:var(--gold);word-break:break-all}
.ip{color:var(--beige);font-size:.78rem;word-break:break-all}
.ts{color:var(--muted);white-space:nowrap}
footer{color:var(--muted);font-size:.75rem;text-align:center;margin-top:28px;line-height:1.7}
a{color:var(--slime);text-underline-offset:2px;text-decoration-color:rgba(125,255,60,.45)}
a:hover{text-decoration-color:var(--slime)}
.stats{display:flex;flex-wrap:wrap;gap:6px 24px;margin:0 0 8px;color:var(--muted);font-size:.85rem}
.stats b{color:var(--beige);font-size:1.05rem}
.more{margin:14px 0 0;font-size:.82rem;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:24px}
.card{border:1px solid rgba(125,255,60,.16);border-radius:8px;padding:10px 12px;background:rgba(8,14,5,.45);min-width:0}
.mini{table-layout:fixed;font-size:.78rem}
.mini td{padding:4px 2px;vertical-align:top}
.mini td.n{width:4.6em}
.mini td.pct{width:3.8em}
.lbl{overflow-wrap:anywhere}
.bar{display:block;height:2px;margin-top:4px;background:var(--slime);opacity:.45;border-radius:1px}
.pct{color:var(--muted);font-size:.74rem}
.tiny{font-size:.7rem;margin-top:6px}
.m{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.04em;padding:1px 5px;border-radius:4px;border:1px solid var(--border);color:var(--beige);white-space:nowrap}
.m-w{border-color:rgba(255,198,60,.55);color:var(--gold)}
.st{font-weight:700;font-variant-numeric:tabular-nums}
.s2{color:var(--slime)}.s3{color:var(--sky)}.s4{color:var(--gold)}.s5{color:var(--red)}.s0{color:var(--muted)}
.u{overflow-wrap:anywhere;color:var(--beige)}
td.u{min-width:14em}
.who{min-width:11em}
.nw{white-space:nowrap}
.u .h{color:var(--muted)}
.u .q{color:var(--sky)}
.ua{overflow-wrap:anywhere;font-size:.78rem}
.net{font-size:.78rem;color:var(--muted);min-width:9em}
.blk{color:var(--red)}
.calls{margin-top:12px;border-top:1px solid var(--line)}
.call{border-bottom:1px solid var(--line)}
.call summary{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:3px 10px;align-items:baseline;padding:8px 6px;cursor:pointer;list-style:none;font-size:.82rem}
.call summary::-webkit-details-marker{display:none}
.call summary:hover{background:rgba(125,255,60,.05)}
.call[open] summary{background:rgba(125,255,60,.09)}
.call .t{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.call .meta{grid-column:3/-1;color:var(--muted);font-size:.74rem;overflow-wrap:anywhere}
@media(max-width:620px){.call .meta{grid-column:1/-1}}
.detail{padding:4px 8px 16px}
.req{margin:10px 0 12px;max-height:340px;overflow:auto;background:#0a1106;border:1px solid var(--border);border-radius:6px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.78rem;color:var(--beige)}
.kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 16px;margin:0;font-size:.8rem}
.kv dt{color:var(--muted)}
.kv dd{margin:0;overflow-wrap:anywhere}
.visitor{margin-bottom:16px}
.note{margin:12px 0 0;font-size:.78rem;color:var(--sky)}
.drill{margin:12px 0 0;font-size:.78rem;color:var(--muted);overflow-wrap:anywhere}
.navs{margin:0 0 22px}
.chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;font-size:.8rem}
.lab{color:var(--muted);margin-left:6px;text-transform:uppercase;font-size:.7rem;letter-spacing:.08em}
.chip{border:1px solid var(--border);border-radius:999px;padding:3px 11px;color:var(--ink);text-decoration:none;background:rgba(125,255,60,.05)}
.chip:hover{border-color:var(--slime)}
.chip.on{background:rgba(125,255,60,.18);border-color:var(--slime);color:var(--beige)}
`;

/** The page shell. `subtitle` and `body` are HTML, already escaped. */
function layout(title, subtitle, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <h1><a href="/">IP GOBLIN STATS</a></h1>
  <p class="sub">${subtitle}</p>
  ${body}
  <footer>
    Aggregate counts from Cloudflare's edge. No tracking code runs on the site
    and no visitor data is stored.<br>
    When traffic is busy Cloudflare keeps a sample of requests and scales the counts up,
    so counts are estimates and call lists show the calls it kept.<br>
    Hostnames come from live reverse-DNS lookups on the busiest visitors;
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

function respond(body, type, status = 200) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': `${type}; charset=utf-8` },
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

    const url = new URL(request.url);

    // Browsers ask for this unprompted. The pages point their icon elsewhere,
    // and answering it here would cost a whole dashboard's worth of queries.
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 404, headers: SECURITY_HEADERS });
    }

    if (!env.STATS_PASSWORD || !env.CF_API_TOKEN) {
      return new Response(
        'Not configured yet. Set the STATS_PASSWORD and CF_API_TOKEN secrets.\n',
        { status: 503, headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    if (!authorized(request, env.STATS_PASSWORD)) return unauthorized();

    const wantsJSON = url.searchParams.get('format') === 'json';

    if (url.pathname === '/calls' || url.pathname === '/calls/') {
      let query;
      try {
        query = parseExplorer(url.searchParams);
      } catch (e) {
        if (e instanceof BadRequest) return respond(`${e.message}\n`, 'text/plain', 400);
        throw e;
      }

      const data = await collectCalls(env, query);
      if (wantsJSON) return respond(JSON.stringify(data, null, 2), 'application/json');

      const ctx = { filters: query.filters, windowKey: query.windowKey };
      return respond(explorerPage(data, env.ZONE_NAME, ctx), 'text/html');
    }

    const stats = await collect(env, url.hostname);

    if (wantsJSON || url.pathname === '/stats.json') {
      return respond(JSON.stringify(stats, null, 2), 'application/json');
    }

    const ctx = {
      filters: {},
      windowKey: DEFAULT_WINDOW,
      apiHost: env.API_HOST || `api.${env.ZONE_NAME}`,
    };
    return respond(dashboardPage(stats, env.ZONE_NAME, ctx), 'text/html');
  },
};
