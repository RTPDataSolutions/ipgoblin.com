
```
  _      _  (`-')                     <-.(`-')            _     <-. (`-')_                        <-. (`-')  
 (_)     \-.(OO )    .->        .->    __( OO)    <-.    (_)       \( OO) )   _             .->      \(OO )_ 
 ,-(`-') _.'    \ ,---(`-')(`-')----. '-'---.\  ,--. )   ,-(`-'),--./ ,--/    \-,-----.(`-')----. ,--./  ,-.)
 | ( OO)(_...--'''  .-(OO )( OO).-.  '| .-. (/  |  (`-') | ( OO)|   \ |  |     |  .--./( OO).-.  '|   `.'   |
 |  |  )|  |_.' ||  | .-, \( _) | |  || '-' `.) |  |OO ) |  |  )|  . '|  |)   /_) (`-')( _) | |  ||  |'.'|  |
(|  |_/ |  .___.'|  | '.(_/ \|  |)|  || /`'.  |(|  '__ |(|  |_/ |  |\    |    ||  |OO ) \|  |)|  ||  |   |  |
 |  |'->|  |     |  '-'  |   '  '-'  '| '--'  / |     |' |  |'->|  | \   |,-.(_'  '--'\  '  '-'  '|  |   |  |
 `--'   `--'      `-----'     `-----' `------'  `-----'  `--'   `--'  `--''-'   `-----'   `-----' `--'   `--'
```

![](https://github.com/RTPDataSolutions/ipgoblin.com/blob/master/mrsmacabre_8-bit_goblin_favicon_b073a0bb-a5de-4d9f-a099-be1f6a2079d9.png?raw=true)

---

## What is in here

| Path | What it is |
| --- | --- |
| `site/` | The static site published to [ipgoblin.com](https://ipgoblin.com) |
| `worker/` | Cloudflare Worker behind [api.ipgoblin.com](https://api.ipgoblin.com) |
| `stats-worker/` | Cloudflare Worker behind `stats.ipgoblin.com`, password protected |
| `speed-worker/` | Cloudflare Worker behind [speed.ipgoblin.com](https://speed.ipgoblin.com), the speed-test backend |
| `goblin-hoard/` | Cloudflare Worker behind [hoard.ipgoblin.com](https://hoard.ipgoblin.com), a 16-bit platformer. See [The arcade](#the-arcade). |
| `ghoul-time/` | Cloudflare Worker behind [ghoultime.ipgoblin.com](https://ghoultime.ipgoblin.com), a BurgerTime-style arcade game |
| `scores-worker/` | Cloudflare Worker behind [scores.ipgoblin.com](https://scores.ipgoblin.com), the arcade's high score tables. See [High scores](#high-scores). |
| `scripts/` | Publish and reporting helpers |
| `.github/workflows/pages.yml` | Pages deploy, currently blocked (see [Deploying](#deploying)) |
| `speedtest/` | An abandoned 2023 speed-test tool with a Node backend. Superseded by `speed-worker/`; see [The speed test](#the-speed-test). |
| `index.php`, `index2.php`, `index3.php`, `*.zip`, loose images | The original 2023 PHP site, kept for reference. Not deployed. |

Seven pieces, deployed independently:

```
ipgoblin.com          ->  Cloudflare  ->  GitHub Pages (gh-pages branch)  <- site/
api.ipgoblin.com      ->  Cloudflare Worker "ipgoblin-api"                <- worker/
stats.ipgoblin.com    ->  Cloudflare Worker "ipgoblin-stats"              <- stats-worker/
speed.ipgoblin.com    ->  Cloudflare Worker "ipgoblin-speed"              <- speed-worker/
hoard.ipgoblin.com    ->  Cloudflare Worker "goblin-hoard"                <- goblin-hoard/
ghoultime.ipgoblin.com -> Cloudflare Worker "ghoul-time"                  <- ghoul-time/
scores.ipgoblin.com   ->  Cloudflare Worker "ipgoblin-scores" + D1        <- scores-worker/
```

Cloudflare is authoritative for DNS and terminates TLS for all seven. The two games are Workers
**static-asset** sites rather than script Workers, so their requests are served straight off the
edge and are not billed as Worker invocations.

## The site

`site/` holds the static IP Goblin site that is published to GitHub Pages at
[ipgoblin.com](https://ipgoblin.com).

| File | Purpose |
| --- | --- |
| `site/index.html` | The page: banner, goblins, IP card, dossier, speed test, arcade links |
| `site/styles.css` | Goblin-green theme, responsive layout |
| `site/app.js` | Client-side IP + geo lookup, flags, taunts, copy buttons |
| `site/speedtest.js` | The speed test, see [The speed test](#the-speed-test) |
| `site/arcade.js` | Puts each game's current leader on its arcade card, see [High scores](#high-scores) |
| `site/CNAME` | Custom domain (`ipgoblin.com`) |
| `site/assets/` | Goblin GIFs and favicons |

The *goblin arcade* section near the bottom of the page links out to the two games and their high
score tables; see [The arcade](#the-arcade).

It is fully static — no PHP — so the visitor's IP is resolved in the browser with
[ipwho.is](https://ipwho.is), falling back to [ipapi.co](https://ipapi.co) and then
[GeoJS](https://geojs.io). IPv4/IPv6 come from [ipify](https://www.ipify.org) and the country
flag from [flagcdn](https://flagcdn.com). Nothing is stored server-side.

The legacy `index.php` / `index2.php` / `index3.php` files are the old PHP versions kept for
reference; they are not deployed.

### Working on the site

There is no build step. Open `site/index.html` directly, or serve the folder so the fetches
behave the way they do in production:

```sh
cd site && python3 -m http.server 8799
```

### Deploying

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `master` that
touches it, and can also be run manually from the Actions tab.

That workflow needs GitHub Actions to be available on the organisation account. While Actions is
unavailable — jobs fail with *"the job was not started because your account is locked due to a
billing issue"* — Pages is instead served from the `gh-pages` branch, which holds the contents of
`site/` at its root. Publish changes with:

```sh
./scripts/publish-gh-pages.sh
```

That script copies `site/` to the `gh-pages` branch and asks Pages to rebuild. It also stamps
`styles.css` and `app.js` references with a content hash, because Cloudflare caches those files at
the edge for four hours and a plain redeploy would keep serving the old ones. HTML is never cached,
so the new hashes take effect immediately. Only the published copy is rewritten; `site/` stays
clean for local development.

Once Actions works again, switch Pages back to the workflow build:

```sh
gh api -X PUT repos/RTPDataSolutions/ipgoblin.com/pages -f build_type=workflow
```

### DNS for ipgoblin.com

The domain is registered at Dynadot but **Cloudflare is authoritative**. Dynadot delegates to
`melinda.ns.cloudflare.com` and `roman.ns.cloudflare.com`; everything else is managed in the
Cloudflare dashboard.

The zone holds these records, all **proxied** (orange cloud):

```
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   rtpdatasolutions.github.io.
CNAME api   <worker custom domain, created by wrangler>
CNAME stats <worker custom domain, created by wrangler>
```

Cloudflare terminates TLS with its own certificate for `ipgoblin.com` and reaches GitHub Pages
over HTTPS. Two zone settings matter:

- **SSL/TLS encryption mode: Full.** GitHub Pages answers SNI for this host under a `*.github.io`
  certificate, so `Full (strict)` would fail.
- **Always Use HTTPS: on** (SSL/TLS → Edge Certificates). This is what makes plain `http://`
  requests to the apex, `www` and `api` return a 301 to `https://`.

GitHub never managed to issue its own certificate for the custom domain, so **Enforce HTTPS stays
off in the repository's Pages settings**. Turning it on would break Cloudflare's connection to the
origin. Leave the custom domain itself set, because Pages needs it to serve the right site for the
`ipgoblin.com` Host header.

## The API

`worker/` is a Cloudflare Worker that reports the caller's IP and location. It reads
`CF-Connecting-IP` and `request.cf` straight off the edge request, so there are no upstream API
calls, no keys and no rate limits beyond the Workers free tier (100k requests/day).

Live at **https://api.ipgoblin.com**, served by a Workers custom domain on the Cloudflare zone.
The default `*.workers.dev` route is disabled, so api.ipgoblin.com is the only way in.

| Endpoint | Returns |
| --- | --- |
| `/` | your IP address, plain text |
| `/json` | every field below as JSON |
| `/ip` | your IP address |
| `/version` | `IPv4` or `IPv6` |
| `/country` | ISO 3166-1 alpha-2 code |
| `/country-name` | country name |
| `/flag` | country flag emoji |
| `/city` | city |
| `/region` | region / state |
| `/timezone` | IANA timezone |
| `/asn` | autonomous system number |
| `/isp` | network operator |
| `/colo` | Cloudflare edge that served the request |
| `/taunt` | a personalised goblin insult |
| `/headers` | the request headers received |
| `/help` | usage |

```sh
curl -L api.ipgoblin.com
curl -L api.ipgoblin.com/json | jq .
curl -4 -L api.ipgoblin.com   # force IPv4
```

CORS is open, so the site itself can call it from the browser.

### Working on the API

```sh
cd worker
npx wrangler dev      # local, on http://127.0.0.1:8787
npx wrangler deploy   # publish
npx wrangler tail     # live logs
```

### The api.ipgoblin.com custom domain

`worker/wrangler.toml` declares the hostname:

```toml
[[routes]]
pattern = "api.ipgoblin.com"
custom_domain = true
```

`npx wrangler deploy` creates and maintains the matching DNS record in the Cloudflare zone, so
there is nothing to add by hand. This only works while Cloudflare is authoritative for the zone.

## The speed test

`speed-worker/` is the `ipgoblin-speed` Worker behind
[speed.ipgoblin.com](https://speed.ipgoblin.com). `site/speedtest.js` drives it from the page.

It measures the link between the visitor and **their nearest Cloudflare edge**, which is what
every browser-based speed test measures. It is not a measurement of the wider internet. The
edge that answered is reported as the colo code (`ATL`, `LHR`, and so on).

### Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/ping` | GET | 204 with no body. Latency and jitter come from round trips. |
| `/down?bytes=N` | GET | `N` bytes of incompressible filler. Capped at 26 MiB per request. |
| `/up` | POST | Reads and discards the body, returns `{"received":N,"colo":"ATL"}`. Rejects over 26 MiB with 413. |
| `/` | GET | Plain-text usage. |

Drive it by hand:

```sh
# download throughput
curl -o /dev/null -s -w '%{speed_download} B/s\n' \
  'https://speed.ipgoblin.com/down?bytes=10000000'

# latency
curl -o /dev/null -s -w '%{time_total}s\n' https://speed.ipgoblin.com/ping
```

### How it stays inside the free plan

Workers allow 10 ms of CPU per request, so the response body is never generated per request.
A pool of 16 random 64 KB blocks is built **once per isolate** and streamed repeatedly, which
makes serving 100 MB cost about the same CPU as serving 100 KB.

The blocks must be distinct. A single block repeated would sit well inside a gzip window and
compress away to nearly nothing, and the measured speed would be a fiction. A 1 MB cycle of
random data is wider than any compression window and incompressible anyway, so what crosses
the wire is what was counted. `crypto.getRandomValues` refuses buffers over 64 KB, which is
why the block size is exactly that.

The stream is `pull`-based so a slow client applies backpressure instead of forcing the Worker
to buffer the whole response.

Note that the 100,000 requests/day free allowance is **account-wide**, shared with the other
script Workers. `ipgoblin-speed` is separate so it can be disabled on its own if its bandwidth
ever becomes a problem, not because it has its own quota.

### How the client measures

- **Latency** — 10 sequential `/ping` round trips. The first is discarded, since it pays for
  DNS, TLS and the TCP handshake. The rest are reported as a **median** (resistant to a single
  outlier) with jitter as the mean absolute difference between consecutive trips.
- **Download** — 4 parallel streams, read incrementally so throughput is sampled continuously
  rather than inferred from a single start/end pair.
- **Upload** — 4 parallel POSTs of random filler. The Worker's response only arrives after it
  has drained the whole body, so the round trip bounds the time the bytes took to arrive.

Both throughput phases discard a **warm-up window** before measuring, because TCP slow start
makes the first second far slower than the steady state. The warm-up is capped at a fraction
of the run, so a fast link that hits its byte budget early still leaves a measurable window
instead of discarding everything.

Each phase is bounded by **both** a time budget and a byte budget, whichever comes first:

| Phase | Time | Bytes |
| --- | --- | --- |
| Download | 8 s | 120 MB |
| Upload | 6 s | 48 MB |

The byte budgets are the important half. On a gigabit link, 8 seconds of unbounded downloading
would pull roughly a gigabyte. They also bound what a visitor on a metered connection spends,
which the page says on the card.

Upload budgets are enforced against bytes *committed* rather than bytes *received*, because
several parallel streams would otherwise all read a stale counter and each launch one more
chunk — which overshot the cap by 86% before it was fixed.

A stream that fails part-way is tolerated rather than fatal: whatever arrived is kept and that
stream bows out. Only a total failure is reported. Opening several fat parallel connections
occasionally trips an edge rate limit, and that should not discard a usable measurement.

### Working on the speed test

```sh
cd speed-worker
npm install
npm run dev      # http://127.0.0.1:8787
npm run deploy
```

`speed-worker/wrangler.toml` declares `speed.ipgoblin.com` as a custom domain, so
`npx wrangler deploy` creates and maintains the DNS record.

The client's `ENDPOINT` constant at the top of `site/speedtest.js` points at production.

### The old speedtest/ directory

`speedtest/` is a 2023 attempt that was never deployed. It is kept for reference only and
**was not ported**, because it could not have worked as a website feature: its
`backend/server.js` ran Ookla's `speedtest-net` *on the server*, so every visitor would have
been shown the server's own bandwidth rather than their own. It also carries ~1,900 committed
`node_modules` files. `speed-worker/` is a rebuild, not a port.

## The arcade

Two games, each its own Cloudflare Worker serving **static assets**. Static assets are not billed
as Worker invocations, so neither one eats into the 100,000 requests/day allowance the script
Workers share. The site links to both from the *goblin arcade* section. Their high score tables are
the one part that does run code; see [High scores](#high-scores).

### goblin-hoard/

[hoard.ipgoblin.com](https://hoard.ipgoblin.com) — **GOBLIN HOARD**, a 16-bit side-scrolling
action platformer: run, flutter-jump, whip, and loot four levels ending in a boss. Slimes, bats,
ghouls, vampires, shield knights and turrets stand in the way; you get eight lives.

Vanilla JS, no dependencies and no build step. Notably it ships **no binary assets** — every
sprite, tile, parallax backdrop, font glyph and note of music is generated in code at load, which
is why the whole game is roughly 100 KB of source and nothing else.

Levels are assembled from hand-authored 24x18 character grids, and the geometry is written against
the movement: a running jump clears 4.4 tiles across and 2.3 up. Edit a level without knowing that
and you will quietly make it impossible. `goblin-hoard/README.md` has the full detail, including
the two-camera rounding rule that keeps the sprite from stuttering.

```sh
cd goblin-hoard
npm install
npm run dev      # http://127.0.0.1:8788
npm run deploy
```

### ghoul-time/

[ghoultime.ipgoblin.com](https://ghoultime.ipgoblin.com) — **GHOUL TIME — Slime Chef**, a
BurgerTime-style single-screen arcade game, entirely contained in one HTML file. See
`ghoul-time/README.md`.

```sh
cd ghoul-time
npm run dev      # http://127.0.0.1:8787
npm run deploy
```

Both declare their hostname as a `custom_domain` route, so `wrangler deploy` creates and maintains
the DNS record in the Cloudflare zone, exactly as the other Workers do.

### High scores

`scores-worker/` is the `ipgoblin-scores` Worker behind
[scores.ipgoblin.com](https://scores.ipgoblin.com): one high score service for both games, backed by
a D1 database called `ipgoblin-scores`.

Every game has **one table: the top ten, never reset.** A name stays on it until better runs push it
off the bottom, and to get on you have to beat the tenth place's score, not just match it, because
ties go to whoever got there first.

The table has **one line per player**: their best run. A player is not an account, just a random id
the browser makes up and keeps in `localStorage`, so the same person on another device is a second
player. Names are up to ten characters of `A-Z 0-9 . _ ! ? -`, which is what GOBLIN HOARD's bitmap
font can draw, and a player's line always shows the name they used last.

Where people see it:

- **In the games.** The title screen alternates with the table, arcade attract-loop style, and left
  and right flip it by hand. The table says what it takes to get on ("BEAT 0012345 TO GET ON THE
  TABLE"), or, for a player already on it, "YOU ARE #3 - DON'T GET KNOCKED OFF". When a run ends
  with points, a form offers to carve a name into the table. It remembers the name, so after the
  first time posting is a single Enter, and a first-timer is offered a random goblin name to accept
  or type over. Escape skips. Then a ranks screen shows where the run landed with the player's own
  line lit up, or, if it missed, the score to beat.
- **On ipgoblin.com.** Each arcade card shows the game's current leader (`site/arcade.js`).
- **At [scores.ipgoblin.com](https://scores.ipgoblin.com).** Both tables as a plain web page.

#### API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/` | GET | Both tables as a web page. `?format=json` for the data. |
| `/v1/boards` | GET | Both tables as JSON. `?limit=1-10`, default 3. |
| `/v1/<game>/leaderboard` | GET | One game's table. `?limit=1-10` (default 10); `?player=<id>` marks that player's line with `you`. |
| `/v1/<game>/runs` | POST | Starts a run and returns its run token. Only from the game's own origin. |
| `/v1/<game>/scores` | POST | `{ run, player, name, score, level, won }`. Only from the game's own origin. |

`<game>` is `goblin-hoard` or `ghoul-time`. Reads are open to anyone, with CORS `*`. A table comes
back as `{ size, top, cutoff }`, where `cutoff` is the score a run has to beat to get on: the tenth
place's, or 0 while there are empty places.

```sh
curl -s https://scores.ipgoblin.com/v1/boards | jq .
```

#### Keeping it honest

Nothing that runs in a browser can prove a score was earned, so the aim is to stop the casual cheat
and bound the damage from the rest:

- **Run tokens.** A game asks for a token when a run starts and hands it back with the score. The
  token carries its issue time and is HMAC-signed with the `RUN_KEY` secret, so the Worker knows how
  long the run took without storing anything up front. A token posts once.
- **Plausibility.** GOBLIN HOARD's levels are finite and nothing respawns, so each level has a hard
  ceiling, counted from `levels.js`. GHOUL TIME never ends, so it is held to a pace instead. Both are
  in `scores-worker/src/games.js` and are generous on purpose: turning away a real run is worse than
  letting an odd one through. Rejected scores are logged, so `npm run tail` shows them.
- **Origin.** Writes are only accepted from the game's own origin. That only binds browsers, but it
  keeps other sites from posting.
- **Rate limits** per IP, with the Workers rate limiting binding: 120 reads, 30 run starts and 10
  scores a minute, counted at each Cloudflare location. Nothing is stored.
- **Names** are checked for slurs and the worst profanity, including disguised spellings. The word
  lists are in `scores-worker/src/names.js`, rot13-encoded so the source does not read as a list of
  slurs.

Someone who reads the game code can still post a believable fake. That is what moderation is for.

#### Moderation

It is all in D1, so moderation is SQL, run from `scores-worker/`:

```sh
# the latest scores, with the player id to act on
npx wrangler d1 execute ipgoblin-scores --remote --command \
  "SELECT id, game, player, name, score, level, seconds, datetime(created_at / 1000, 'unixepoch') AS at
   FROM runs ORDER BY id DESC LIMIT 20"

# take a player off every table
npx wrangler d1 execute ipgoblin-scores --remote --command \
  "UPDATE bests SET hidden = 1 WHERE player = '<player id>'"
```

Hiding sticks, because a posted score never changes a player's `hidden` flag. Set it back to `0` to
undo it. `runs` keeps every accepted score, so a table can always be rebuilt from it.

#### Privacy and budget

The scoreboard keeps the name, score, level reached, when, and the random player id. No IP
addresses, no cookies, no accounts, and both the name form and the arcade section on ipgoblin.com
say so. A player who rolls off the table keeps their row in `bests`, out of sight, because that is
how a later run knows whether it beat their best.

Every request is a Worker invocation, so it counts against the account-wide 100,000 a day. D1's free
plan allows 5 million rows read and 100,000 written a day: a table read walks an index and reads
about as many rows as it returns, and posting a score writes a handful.

#### Working on the scores

```sh
cd scores-worker
npm install
cp .dev.vars.example .dev.vars   # a local RUN_KEY, and lets games on localhost post
npm run migrate:local
npm run dev                      # http://127.0.0.1:8789
npm test                         # node --test, against Node's built-in SQLite (Node 22.13+)
```

Games served from `localhost` or `127.0.0.1` talk to the local Worker on port 8789; everywhere else
they talk to scores.ipgoblin.com.

#### Deploying the scores

The D1 database already exists and its id is in `wrangler.toml`. The first deploy is:

```sh
cd scores-worker
npm install
npm run migrate:remote                                  # create the tables
npm run deploy                                          # creates scores.ipgoblin.com
openssl rand -hex 32 | npx wrangler secret put RUN_KEY  # sign run tokens
```

Until `RUN_KEY` is set the tables can be read but no run can start, and the games say the
scoreboard is out of reach. Then deploy both games with `npm run deploy` and publish the site with
`./scripts/publish-gh-pages.sh`.

Later schema changes go in a new numbered file in `scores-worker/migrations/`, applied with
`npm run migrate:remote` before the deploy that needs them.

## Checking usage

Cloudflare counts every request it proxies, so traffic numbers exist without
any tracking code on the site. There are two ways to read them.

### stats.ipgoblin.com

A password-protected dashboard, served by the `ipgoblin-stats` Worker in
`stats-worker/`. Visit <https://stats.ipgoblin.com> and the browser will ask
for a username and password: the username is `goblin`, the password is the
`STATS_PASSWORD` secret. Add `?format=json` to any page for the raw numbers.

The dashboard shows seven sections:

  * **Traffic, last 7 days** — requests, page views, uniques and bytes per day.
  * **Last 24 hours** — requests split by hostname and by country.
  * **How calls are made, last 24 hours** — the top calls (method, host, path
    and status), then how they arrive: method, status, HTTP version, TLS
    version, TLS key exchange, content type, cache, security action, browser,
    OS, device, verified bots, the Cloudflare edge that answered, the networks
    they come from, and the raw user agents.
  * **Security rules that fired, last 24 hours** — which Cloudflare rules
    blocked or challenged calls, and how often.
  * **Visitor stream, last 24 hours** — one row per unique visitor.
  * **Latest calls** — the newest calls one by one, leaving out the
    dashboard's own.
  * **API worker, last 24 hours** — `ipgoblin-api` requests and errors by status.

The visitor stream collapses the edge data to one row per client IP, so
somebody who requested twenty URLs is a single line with a hit count rather
than twenty lines. Each row carries the hostname and IP, country, network
(ASN), a shortened user agent, device type, hit count, how many distinct paths
they touched, and when they were last seen.

Hostnames are resolved live over DNS-over-HTTPS for the busiest visitors only,
capped so the page stays inside the Worker subrequest budget. Most residential
addresses have no PTR record and show as *no reverse DNS*; hosting providers
and scanners usually do resolve, which is what makes the column worth having.
Lookups are batched, individually timed out, and never fatal.

#### The call explorer

Every hostname, country, IP, call and breakdown value on the dashboard is a
link into the call explorer at `/calls`, which drills into any slice of the
traffic:

    /calls?ip=203.0.113.9                    everything one visitor did
    /calls?host=api.ipgoblin.com             every call to the API
    /calls?host=api.ipgoblin.com&path=/json  one endpoint
    /calls?action=block&window=7d            what Cloudflare blocked this week
    /calls?agent=                            calls that sent no user agent

Filters combine. The parameters are `ip`, `host`, `path`, `method`, `status`,
`protocol`, `tls`, `type`, `cache`, `action`, `source`, `country`, `device`,
`browser`, `os`, `bot` and `agent`, each an exact match. `window` is `24h`
(the default), `7d` or `30d`.

Each explorer page shows the same breakdowns for its slice, plus the top
callers with their reverse DNS and network, the security rules that fired,
and the calls themselves, 200 to a page, newest first. Open a call to see:

  * the request as it reached the edge: the request line, or the HTTP/2 and
    HTTP/3 pseudo-headers, with the host, query string and user agent;
  * when, from which IP, country, device and network (ASN);
  * the scheme, HTTP version and TLS version it came over;
  * the status, content type and cache status it got back, and whether the
    origin was contacted and how long it took;
  * for blocked calls, the Cloudflare rule that stopped it and its ray ID,
    which can be looked up under **Security -> Events**.

The call list only holds what Cloudflare keeps. When traffic is busy it stores
a sample of requests (1 in 3 is typical here, more on longer windows) and
scales the counts up, so counts are estimates and each page says how many
calls were kept one by one. Headers other than the user agent, and request
bodies, are never recorded.

It lives in its own Worker rather than as a route on `api.ipgoblin.com` so
that the Cloudflare API token is not sitting on the public API surface. The
token is only ever used server-side and never reaches the browser. The page
sends `no-store` and `noindex`.

Two secrets are needed before it will serve anything; until they are set it
answers 503. Set them from `stats-worker/`:

    npx wrangler secret put CF_API_TOKEN
    npx wrangler secret put STATS_PASSWORD

`CF_API_TOKEN` is a Cloudflare API token created at
<https://dash.cloudflare.com/profile/api-tokens> with **Create Custom Token**.
The one in use is named `ipgoblin-stats-readonly` and carries exactly two
read permissions, which are enough to read analytics and nothing else:

  * Account -> **Account Analytics** -> Read
  * Zone -> **Analytics** -> Read

Note the second is listed as just *Analytics* once the group is set to Zone;
there is no "Zone Analytics" entry in that group. Scope it to Account
Resources *Include -> All accounts* and Zone Resources
*Include -> Specific zone -> ipgoblin.com*.

The token cannot change anything, cannot pull Cloudflare's full request logs
(Logpull or Logpush; the call explorer only sees the sampled requests that
analytics keeps), and cannot touch DNS. It is stored only as a Worker secret
and is never committed.

Deploy changes with `npx wrangler deploy` from `stats-worker/`, and check what
is set with `npx wrangler secret list`.

### From the command line

    ./scripts/stats.sh          # last 7 days
    ./scripts/stats.sh 3        # last 3 days

Same numbers in the terminal. This one authenticates with the existing
wrangler login instead of a stored token, so there is nothing to configure; if
it fails, run `npx wrangler login`.

### Notes

The same data is in Cloudflare under **ipgoblin.com -> Analytics & Logs
-> Traffic** and **Workers & Pages -> ipgoblin-api -> Metrics**.

Free-plan limits, which both tools are written to:

  * the daily dataset keeps **7 days**;
  * the detailed request datasets answer for up to **30 days** (checked
    against the zone's GraphQL `settings` node in September 2026; earlier they
    stopped at 24 hours). The dashboard's detailed sections still cover the
    last 24 hours, and the call explorer offers 24 hours, 7 days or 30 days;
  * some fields are paid-only or only exist on some datasets. Client ASN
    cannot be grouped on, but it is readable on individual requests, so the
    dashboard reads a light pass of those to put a network against each
    visitor. Referer is only recorded on security events, so it is not shown.
    The edge colo and TLS key exchange can be counted but not filtered on;
  * one GraphQL request may carry only about 50 dataset queries, and a Worker
    on the free plan may make 50 subrequests per request. The dashboard spends
    8 GraphQL requests and up to 36 reverse-DNS lookups; an explorer page
    spends 3 and up to 10.

On privacy: the site still runs no tracking code, sets no cookies, and stores
nothing itself — the "nothing is logged here" promise on the page is about the
site. The numbers here come from Cloudflare's own edge analytics, which every
proxied request produces regardless. The daily and country sections are pure
aggregates, but the visitor stream and the call explorer show individual client
IP addresses, resolved hostnames, full user agents and query strings, which can
carry anything a caller chose to send. Treat those pages as sensitive and keep
them behind their password.

A fair share of the non-US traffic is bots and scanners rather than people. The
visitor stream makes this obvious: look for agents like `l9scan`, `Baiduspider`
or `zgrab`, hostnames under `scan.leakix.org`, networks belonging to hosting
providers, and visitors whose path count is far higher than a human would ever
produce. The call explorer shows what they were after: most calls to
`api.ipgoblin.com` are WordPress and CVE probes rather than IP lookups.
