/**
 * IP Goblin API — a Cloudflare Worker that tells callers what the goblins can see.
 *
 * Everything is derived from the edge request itself (`CF-Connecting-IP` and
 * `request.cf`), so there are no upstream API calls, no keys and no rate limits
 * beyond the Workers free tier.
 */

const TAUNTS = [
  'The goblins see you at {ip}. Hiding is not going well.',
  '{ip} — logged, sniffed and giggled about in {city}.',
  'Another {country} visitor. {ip} smells like {isp}.',
  'We found {ip} loitering near {colo}. Suspicious.',
  'Packets from {ip} arrived wheezing. {asn} needs a rest.',
  '{ip} thinks it is anonymous. The goblins think otherwise.',
  'Greetings, {ip}. Your timezone ({timezone}) betrays you.',
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** Turn an ISO 3166-1 alpha-2 code into its regional-indicator emoji. */
function flagEmoji(cc) {
  if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return null;
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

function isIPv6(ip) {
  return typeof ip === 'string' && ip.includes(':');
}

let countryNames;

/** Expand a country code into its English name. */
function countryName(cc) {
  if (!cc || cc.length !== 2) return null;
  try {
    countryNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
    const name = countryNames.of(cc.toUpperCase());
    return name === cc.toUpperCase() ? null : name;
  } catch {
    return null;
  }
}

/** Collapse the request into the shape every endpoint reads from. */
function inspect(request) {
  // `request.cf` is absent during local `wrangler dev` without --remote.
  const cf = request.cf || {};
  const ip = request.headers.get('cf-connecting-ip') || null;
  const country = cf.country || null;

  return {
    ip,
    version: ip ? (isIPv6(ip) ? 'IPv6' : 'IPv4') : null,
    country,
    country_name: cf.countryName || countryName(country),
    flag: flagEmoji(country),
    region: cf.region || null,
    region_code: cf.regionCode || null,
    city: cf.city || null,
    postal_code: cf.postalCode || null,
    continent: cf.continent || null,
    latitude: cf.latitude ? Number(cf.latitude) : null,
    longitude: cf.longitude ? Number(cf.longitude) : null,
    timezone: cf.timezone || null,
    asn: cf.asn ? `AS${cf.asn}` : null,
    isp: cf.asOrganization || null,
    colo: cf.colo || null,
    http_protocol: cf.httpProtocol || null,
    tls_version: cf.tlsVersion || null,
    user_agent: request.headers.get('user-agent') || null,
  };
}

function fill(template, data) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => {
    const value = data[key];
    return value === null || value === undefined ? whole : String(value);
  });
}

/** Pick a taunt whose placeholders we can actually fill in. */
function taunt(data) {
  const usable = TAUNTS.filter((t) =>
    [...t.matchAll(/\{(\w+)\}/g)].every(([, key]) => data[key]),
  );
  const pool = usable.length ? usable : [TAUNTS[0]];
  return fill(pool[Math.floor(Math.random() * pool.length)], data);
}

function text(body, status = 200, extra = {}) {
  return new Response(`${body}\n`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
      ...extra,
    },
  });
}

function json(body, status = 200) {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

const USAGE = `IP GOBLIN API

  GET /             your IP address, plain text
  GET /json         everything the goblins know, as JSON
  GET /ip           your IP address, plain text
  GET /version      IPv4 or IPv6
  GET /country      ISO country code
  GET /country-name country name
  GET /flag         country flag emoji
  GET /city         city
  GET /region       region / state
  GET /timezone     IANA timezone
  GET /asn          autonomous system number
  GET /isp          network operator
  GET /colo         Cloudflare edge that served you
  GET /taunt        a goblin insult, personalised
  GET /headers      the request headers we received
  GET /help         this message

Examples:

  curl -L api.ipgoblin.com
  curl -L api.ipgoblin.com/json | jq .
  curl -L api.ipgoblin.com/taunt

Force a protocol with curl's -4 / -6 flags.

https://ipgoblin.com`;

/** Endpoints that just echo one field back as plain text. */
const FIELDS = {
  '/ip': 'ip',
  '/version': 'version',
  '/country': 'country',
  '/country-name': 'country_name',
  '/flag': 'flag',
  '/city': 'city',
  '/region': 'region',
  '/timezone': 'timezone',
  '/asn': 'asn',
  '/isp': 'isp',
  '/colo': 'colo',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('The goblins only answer GET requests.', 405, {
        allow: 'GET, HEAD, OPTIONS',
      });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const data = inspect(request);

    if (path === '/') return text(data.ip ?? 'unknown');
    if (path === '/json') return json(data);
    if (path === '/help') return text(USAGE);
    if (path === '/taunt') return text(taunt(data));

    if (path === '/headers') {
      return json(Object.fromEntries(request.headers));
    }

    const field = FIELDS[path];
    if (field) {
      const value = data[field];
      return value ? text(value) : text('unknown', 404);
    }

    return text(`No goblin lives at ${path}.\n\n${USAGE}`, 404);
  },
};
