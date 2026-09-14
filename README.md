
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

## The site

`site/` holds the static IP Goblin site that is published to GitHub Pages at
[ipgoblin.com](https://ipgoblin.com).

| File | Purpose |
| --- | --- |
| `site/index.html` | The page: banner, goblins, IP card, dossier |
| `site/styles.css` | Goblin-green theme, responsive layout |
| `site/app.js` | Client-side IP + geo lookup, flags, taunts, copy buttons |
| `site/CNAME` | Custom domain (`ipgoblin.com`) |
| `site/assets/` | Goblin GIFs and favicons |

It is fully static — no PHP — so the visitor's IP is resolved in the browser with
[ipwho.is](https://ipwho.is), falling back to [ipapi.co](https://ipapi.co) and then
[GeoJS](https://geojs.io). IPv4/IPv6 come from [ipify](https://www.ipify.org) and the country
flag from [flagcdn](https://flagcdn.com). Nothing is stored server-side.

The legacy `index.php` / `index2.php` / `index3.php` files are the old PHP versions kept for
reference; they are not deployed.

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
A     @   185.199.108.153
A     @   185.199.109.153
A     @   185.199.110.153
A     @   185.199.111.153
CNAME www rtpdatasolutions.github.io.
CNAME api <worker custom domain, created by wrangler>
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

## Checking usage

Cloudflare counts every request it proxies, so traffic numbers exist without
any tracking code on the site. There are two ways to read them.

### stats.ipgoblin.com

A password-protected dashboard, served by the `ipgoblin-stats` Worker in
`stats-worker/`. Visit <https://stats.ipgoblin.com> and the browser will ask
for a username and password: the username is `goblin`, the password is the
`STATS_PASSWORD` secret. Add `?format=json` for the raw numbers.

It lives in its own Worker rather than as a route on `api.ipgoblin.com` so
that the Cloudflare API token is not sitting on the public API surface. The
token is only ever used server-side and never reaches the browser. The page
sends `no-store` and `noindex`.

Two secrets are needed before it will serve anything; until they are set it
answers 503. Set them from `stats-worker/`:

    npx wrangler secret put CF_API_TOKEN
    npx wrangler secret put STATS_PASSWORD

`CF_API_TOKEN` is a Cloudflare API token created at
<https://dash.cloudflare.com/profile/api-tokens> with exactly two read
permissions, which are enough to read analytics and nothing else:

  * Account -> Account Analytics -> Read
  * Zone -> Zone Analytics -> Read

Deploy changes with `npx wrangler deploy` from `stats-worker/`.

### From the command line

    ./scripts/stats.sh          # last 7 days
    ./scripts/stats.sh 3        # last 3 days

Same numbers in the terminal. This one authenticates with the existing
wrangler login instead of a stored token, so there is nothing to configure; if
it fails, run `npx wrangler login`.

### Notes

The dashboard is also in Cloudflare under **ipgoblin.com -> Analytics & Logs
-> Traffic** and **Workers & Pages -> ipgoblin-api -> Metrics**.

Free-plan limits: the daily dataset keeps 7 days, and the per-country dataset
only answers for a 24-hour window. Both tools are written to those limits.

These are aggregate edge counts, not visitor logs, so the site's "nothing is
logged here" promise still holds. Note that a fair share of the non-US traffic
is bots and scanners rather than people.
