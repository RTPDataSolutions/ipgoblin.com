/**
 * IP Goblin API — a Cloudflare Worker that tells callers what the goblins can see.
 *
 * Everything is derived from the edge request itself (`CF-Connecting-IP` and
 * `request.cf`), so there are no upstream API calls, no keys and no rate limits
 * beyond the Workers free tier.
 */

const TAUNTS = [
  'Ha! {ip} — we wrote it on the cave wall in glitter.',
  'Your IP is {ip}. We have memorized it. We will forget it in nine seconds. Probably.',
  'We told the other goblins about {ip}. They laughed. Then they asked for snacks.',
  'You came here to find your IP and we found YOU. Classic goblin business model.',
  '{ip}. We said it out loud. The cave echoed. Everyone heard.',
  '{ip} arrived wearing no disguise at all. Bold.',
  'We put {ip} on a sticky note. The sticky note is on a goblin. The goblin is asleep.',
  '{ip} knocked. We did not answer. We just wrote it down.',
  'A packet from {ip} wandered in and asked for directions. We gave it wrong ones.',
  '{ip}? Never heard of it. (We have. It is in the ledger. Page four.)',
  'The goblins voted. {ip} is the seventh-best IP they have seen today.',
  '{ip} — spelled it twice, laughed both times.',
  'We ran {ip} through the machine. The machine said \'yep, that is an IP\'. Ten gold pieces.',
  'Somewhere a firewall thinks it is protecting {ip}. Adorable.',
  '{ip} came here voluntarily. That is the part we find funniest.',
  'Your address is {ip}. Your secret is safe with us and the forty goblins behind us.',
  '{ip} has been added to the wall. The wall is full. We are getting a bigger wall.',
  'Hello {ip}. Goodbye {ip}. We are already bored of {ip}.',
  '{ip} looks expensive. Is it expensive? We will assume it is expensive.',
  'The goblins tried to eat {ip}. It was not food. They are disappointed.',
  '{ip} — a fine number. Not the finest. Fine.',
  'We showed {ip} to the oldest goblin. He squinted. He approved. Mostly.',
  '{ip} will be traded to another goblin for half a sandwich.',
  'Congratulations, {ip}. You are exactly where you said you were.',
  '{ip} tried to sneak past. It was walking very loudly.',
  'We have {ip} written in three places now. One of them is a goblin forehead.',
  '{ip}: catalogued, mocked, filed under \'later\'.',
  'The goblins have opinions about {ip}. None of them are kind.',
  '{ip} showed up uninvited, which is the only way anyone shows up here.',
  'We asked the network who you were. It said {ip} immediately. No loyalty.',
  '{ip} — we will remember this. We will not remember why.',
  'Every packet you send waves a little flag that says {ip}. Every single one.',
  '{ip} is now goblin property. Read the sign. There is no sign.',
  'We could keep {ip} a secret. We have chosen not to.',
  'A goblin scribbled {ip} on the ceiling. We do not know how.',
  '{ip}. Yes. That is the one. That is definitely the one.',
  'You wanted your IP. Here: {ip}. Now leave before they notice.',
  '{ip} has been reported to the goblin council. The council is three rats.',
  'We tracked {ip} across the whole internet. It took no effort at all.',
  '{ip} thought about using a VPN. Thinking is not using.',
  'The goblins chanted {ip} for a while. Then they got tired.',
  '{ip} is not hiding. {ip} has never hidden. {ip} does not know how.',
  'We would forget {ip}, but the little one is already singing about it.',
  '{ip} arrived at the door and immediately handed us everything.',
  'There is a jar. In the jar is {ip}. Do not ask about the jar.',
  '{country_name} {flag}? We knew it. The little one sniffed the packets and guessed right.',
  'You typed a domain and we caught your whole packet. Amateur hour, {country_name} {flag}.',
  '{flag} {country_name}. The goblins have been there. They were asked to leave.',
  'All the way from {country_name} {flag} just to be insulted. Worth it.',
  '{country_name} {flag} — good choice. The goblins have a cousin there. Do not trust him.',
  'A {country_name} {flag} packet walks into a cave. The cave writes down {ip}.',
  '{flag} Ah, {country_name}. That explains the smell of the packets. Pleasant, mostly.',
  'The goblins raised the {country_name} flag {flag}. Upside down. On purpose. Probably.',
  'Nobody from {country_name} {flag} has ever escaped this page. Nobody has tried.',
  '{country_name} {flag} sends its worst. We accept.',
  'You are {ip}, of {country_name} {flag}, and you are not subtle.',
  '{flag} The {country_name} goblins are worse than us. Count yourself lucky.',
  'We have a map. {country_name} {flag} is on it. You are on it now too.',
  'Welcome, {country_name} {flag}. Wipe your packets at the door.',
  '{country_name} {flag}. The goblins nod. That is all you get.',
  'A visitor from {city}! The goblins are already knocking on the wrong door.',
  'Nice coordinates, {city}. We looked. There is a bin outside. We approve of the bin.',
  '{city}. We have not been. We have opinions anyway.',
  'Someone in {city} just got a lot less anonymous.',
  '{city} — lovely place. Terrible packets.',
  'The goblins are dispatching a scout to {city}. He will get lost. He always does.',
  '{ip} of {city}. It rhymes if you say it wrong.',
  'We have marked {city} on the map with a crayon. It is the wrong colour.',
  '{city}? The goblins were banned from {city}. Long story. Bad story.',
  'Say hello to {city} for us. Do not say who sent you.',
  'Everything interesting in {city} is happening at {ip} right now. Allegedly.',
  'The little goblin wants to visit {city}. He has no legs. He has ambition.',
  '{city}. Filed. Laminated. Mocked.',
  'There are goblins under {city}. There are goblins under everywhere.',
  'You are in {city} and your router told us so without hesitating.',
  '{isp} handed us your address without even asking who we were. Rude. Efficient, but rude.',
  '{isp} is doing its best. Its best is telling us exactly where you are.',
  'We sent {isp} a thank-you note for {ip}. No reply. Typical.',
  '{isp} could have stopped this. {isp} did not even blink.',
  'Your packets wear a little {isp} hat. We can see the hat.',
  '{isp} — the goblins salute you, informant.',
  'Somewhere at {isp} there is a goblin on the payroll. Allegedly.',
  '{isp} gave you {ip} and a lifetime of being findable.',
  'If {isp} were a goblin, it would be the one who talks too much.',
  'We asked {isp} nicely. We did not have to ask nicely.',
  '{asn} — that is the ugliest number we have seen since Tuesday. Congratulations.',
  '{asn}. The goblins tried to pronounce it. Two of them fainted.',
  'You ride in on {asn} like it means something. It does. It means we found you.',
  '{asn} is a fine autonomous system. Autonomous. Not private. Learn the difference.',
  'The goblins have a grudge against {asn}. They have forgotten why.',
  '{asn} carried your packets all this way just to hand them to us.',
  'We have {asn} in the ledger under \'frequent offenders\'.',
  'The clock in your pocket says {timezone}. It is always goblin o\'clock here.',
  '{timezone}? Should you not be asleep? The goblins are asleep. Mostly.',
  'Your clock says {timezone}. Ours says \'soon\'. Ours is better.',
  'We know it is {timezone} where you are. We know more than that.',
  '{timezone} — a fine time to be caught.',
  'The goblins do not observe {timezone}. The goblins observe nothing.',
  'Somewhere in {timezone}, {ip} is doing something it should not.',
  '{timezone}. Noted. Your schedule is now goblin business.',
  'Somewhere in {region}, a router is crying. That router is yours.',
  '{region} is not big enough to hide {ip}. Nowhere is.',
  'The goblins have relatives in {region}. Do not contact them.',
  '{region}. Bold of you to have a location at all.',
  'We narrowed it to {region}, then to {city}, then we got bored and wrote {ip}.',
  'All of {region} just got tagged because of you.',
  '{city}, {region}, {country_name} {flag}. We did not have to work for any of that.',
  '{isp} in {city} — a combination the goblins find hilarious.',
  '{ip} from {city} riding {asn}. A whole biography in one packet.',
  'It is {timezone} in {city} and {ip} is still awake. Suspicious.',
  '{flag} {country_name} routes its shame through {isp}. We just watch.',
  'The ledger now reads: {ip}, {city}, {country_name}. Signed, a goblin.',
  '{asn} in {country_name} {flag}. The goblins are updating the chart.',
  'You, {ip}, in {timezone}, thinking nobody would look. We always look.',
  '{isp} says {region}. The packets say {city}. Both of them told on you.',
  'The goblins see you at {ip}. Hiding is not going well.',
  '{ip} — logged, sniffed and giggled about in {city}.',
  'Another {country_name} visitor. {ip} smells like {isp}.',
  'We found {ip} loitering near {colo}. Suspicious.',
  'Packets from {ip} arrived wheezing. {asn} needs a rest.',
  '{ip} thinks it is anonymous. The goblins think otherwise.',
  'Greetings, {ip}. Your timezone ({timezone}) betrays you.',
  'Your packets touched down at {colo}. The goblins were waiting.',
  '{colo} caught you. {colo} always catches you.',
  'The goblins at {colo} say hello. They are lying. They said something ruder.',
  '{ip} routed through {colo} like it had nothing to hide.',
  '{colo} is the nearest goblin outpost to you. Sleep well.',
  'Edge {colo}. Distance: irrelevant. We already have {ip}.',
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
