
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

Point the apex at GitHub Pages. The records below are live at Dynadot (the AAAA records are
optional and are not currently set):

```
A     @   185.199.108.153
A     @   185.199.109.153
A     @   185.199.110.153
A     @   185.199.111.153
AAAA  @   2606:50c0:8000::153
AAAA  @   2606:50c0:8001::153
AAAA  @   2606:50c0:8002::153
AAAA  @   2606:50c0:8003::153
CNAME www rtpdatasolutions.github.io.
```

Then enable **Enforce HTTPS** in the repository's Pages settings.

## The API

`worker/` is a Cloudflare Worker that reports the caller's IP and location. It reads
`CF-Connecting-IP` and `request.cf` straight off the edge request, so there are no upstream API
calls, no keys and no rate limits beyond the Workers free tier (100k requests/day).

Live at **https://ipgoblin-api.melanie-stewart.workers.dev**.

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
curl -L ipgoblin-api.melanie-stewart.workers.dev
curl -L ipgoblin-api.melanie-stewart.workers.dev/json | jq .
curl -4 -L ipgoblin-api.melanie-stewart.workers.dev   # force IPv4
```

CORS is open, so the site itself can call it from the browser.

### Working on the API

```sh
cd worker
npx wrangler dev      # local, on http://127.0.0.1:8787
npx wrangler deploy   # publish
npx wrangler tail     # live logs
```

### Moving the API to api.ipgoblin.com

Workers custom domains only work when Cloudflare is authoritative for the zone, and ipgoblin.com
currently uses Dynadot DNS. To switch:

1. Add ipgoblin.com to a Cloudflare account and let it import the existing records.
2. Confirm the four `185.199.*.153` A records and the `www` CNAME came across, set to **DNS only**
   (grey cloud) so GitHub Pages keeps serving the apex and its certificate.
3. Change the nameservers at Dynadot to the pair Cloudflare provides.
4. Uncomment the `[[routes]]` block in `worker/wrangler.toml` and run `npx wrangler deploy`.
5. Update the `curl` command in `site/index.html` and the URLs above.
