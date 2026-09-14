#!/usr/bin/env bash
# Show how much ipgoblin.com and api.ipgoblin.com are being used.
#
# Reads Cloudflare's GraphQL analytics API. No tracking code runs on the site;
# these are the request counts Cloudflare already keeps at the edge as a
# side effect of proxying traffic.
#
# Auth piggybacks on the wrangler OAuth login, so if this fails run:
#   npx wrangler login
#
# Usage: ./scripts/stats.sh [days]      (default 7, max 7 on the free plan)

set -euo pipefail

ZONE="ipgoblin.com"
WORKER="ipgoblin-api"
DAYS="${1:-7}"

cfg="$HOME/Library/Preferences/.wrangler/config/default.toml"
[ -f "$cfg" ] || cfg="$HOME/.config/.wrangler/config/default.toml"
[ -f "$cfg" ] || { echo "error: no wrangler config; run 'npx wrangler login'" >&2; exit 1; }

# wrangler refreshes the access token on use, and it expires quickly.
npx --yes wrangler@latest whoami >/dev/null 2>&1 || true
TOK="$(grep -E '^oauth_token' "$cfg" | sed 's/.*= *"//; s/"$//')"
[ -n "$TOK" ] || { echo "error: no oauth_token in $cfg" >&2; exit 1; }

api() { curl -sS -H "Authorization: Bearer $TOK" "https://api.cloudflare.com/client/v4/$1"; }
gql() { curl -sS -X POST https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @-; }

# BSD date on macOS, GNU date elsewhere.
ago_date() { date -u -v-"$1"d +%Y-%m-%d 2>/dev/null || date -u -d "$1 days ago" +%Y-%m-%d; }
ago_time() { date -u -v-"$1"H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "$1 hours ago" +%Y-%m-%dT%H:%M:%SZ; }

ZID="$(api "zones?name=$ZONE" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d.get("result") else "")')"
[ -n "$ZID" ] || { echo "error: could not resolve zone $ZONE (token expired?)" >&2; exit 1; }
ACC="$(api accounts | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d.get("result") else "")')"

SINCE_D="$(ago_date "$DAYS")"; TODAY="$(date -u +%Y-%m-%d)"
SINCE_H="$(ago_time 23)";      NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

render() { python3 "$(dirname "${BASH_SOURCE[0]}")/_stats_render.py" "$1"; }

echo "=== Site traffic, last $DAYS days ($ZONE) ==="
printf '{"query":"query($z:String!,$a:Date!,$b:Date!){viewer{zones(filter:{zoneTag:$z}){httpRequests1dGroups(limit:%d,orderBy:[date_ASC],filter:{date_geq:$a,date_leq:$b}){dimensions{date}sum{requests pageViews bytes}uniq{uniques}}}}}","variables":{"z":"%s","a":"%s","b":"%s"}}' \
  "$DAYS" "$ZID" "$SINCE_D" "$TODAY" | gql | render daily

echo
echo "=== Last 24h by hostname and country ==="
printf '{"query":"query($z:String!,$a:Time!,$b:Time!){viewer{zones(filter:{zoneTag:$z}){httpRequestsAdaptiveGroups(limit:25,orderBy:[count_DESC],filter:{datetime_geq:$a,datetime_lt:$b}){count dimensions{clientRequestHTTPHost clientCountryName}}}}}","variables":{"z":"%s","a":"%s","b":"%s"}}' \
  "$ZID" "$SINCE_H" "$NOW" | gql | render hosts

echo
echo "=== API Worker ($WORKER), last 24h ==="
printf '{"query":"query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$s,datetime_lt:$u,scriptName:\\"%s\\"}){sum{requests errors}dimensions{status}}}}}","variables":{"a":"%s","s":"%s","u":"%s"}}' \
  "$WORKER" "$ACC" "$SINCE_H" "$NOW" | gql | render worker
