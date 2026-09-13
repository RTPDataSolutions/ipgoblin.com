
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
