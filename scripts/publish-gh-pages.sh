#!/usr/bin/env bash
# Publish site/ to the gh-pages branch and trigger a GitHub Pages build.
#
# This is the fallback for when GitHub Actions is unavailable (for example while
# the organisation account is locked for billing). When Actions is working again,
# switch Pages back to the workflow build and let .github/workflows/pages.yml do
# this automatically:
#
#   gh api -X PUT repos/RTPDataSolutions/ipgoblin.com/pages -f build_type=workflow
#
# Usage:
#   ./scripts/publish-gh-pages.sh            publish, refusing if site/ is stale
#   ./scripts/publish-gh-pages.sh --check    report staleness and exit, publish nothing
#   ./scripts/publish-gh-pages.sh --force    skip the staleness check and publish
#
# --force does NOT bypass the repository check: this script force-pushes, so it
# always refuses to run from a checkout that is not the target repo.

set -euo pipefail

REPO="RTPDataSolutions/ipgoblin.com"
BRANCH="gh-pages"
DEFAULT_BRANCH="master"

force=0
check_only=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) force=1 ;;
    --check|-n) check_only=1 ;;
    --help|-h)
      sed -n "2,18p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/site"

[ -d "$src" ] || { echo "error: $src not found" >&2; exit 1; }

# REPO is hardcoded and the push below is a force-push, so running this script
# from ANY directory rewrites the real gh-pages branch. A copy of this script in
# a scratch clone will happily overwrite production, which is how a throwaway
# test fixture once replaced the live site.
#
# So require that the checkout we are publishing from is actually that repo.
# Set IPGOBLIN_PUBLISH_REPO to publish from a fork or a test fixture.
origin_check() {
  local want="${IPGOBLIN_PUBLISH_REPO:-$REPO}"
  REPO="$want"

  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "error: $root is not a git checkout." >&2
    echo "This script force-pushes to $want; refusing to run from a loose copy." >&2
    return 1
  }

  local url
  url="$(git -C "$root" remote get-url origin 2>/dev/null || echo '')"

  # Accept https and ssh spellings, with or without .git
  local slug
  slug="$(printf '%s' "$url" | sed -e 's#^git@github.com:#(#' -e 's#^https://github.com/##' -e 's#^(##' -e 's#\.git$##')"

  if [ "$slug" != "$want" ]; then
    echo "REFUSING TO PUBLISH: wrong repository." >&2
    echo >&2
    echo "  this checkout : ${slug:-<no origin remote>}" >&2
    echo "  would push to : $want (force)" >&2
    echo >&2
    echo "This script force-pushes to a hardcoded repo, so running it from an" >&2
    echo "unrelated checkout would overwrite the live site with that tree." >&2
    echo >&2
    echo "If this is deliberate, set the target explicitly:" >&2
    echo "    IPGOBLIN_PUBLISH_REPO=owner/repo $(basename "${BASH_SOURCE[0]}")" >&2
    return 1
  fi
  return 0
}

origin_check || exit 1

# This script force-pushes whatever is in site/ right now, so publishing from a
# branch that is behind the default branch silently reverts the live site to an
# older state. That has happened: a publish from a stale branch removed the
# goblin arcade from ipgoblin.com, and nothing failed to signal it.
#
# So before pushing, check whether the default branch has changes to site/ that
# this working tree does not have, and refuse if so.
stale_check() {
  git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "note: not a git checkout, skipping the staleness check." >&2
    return 0
  }

  echo "Checking site/ against origin/${DEFAULT_BRANCH}..."
  if ! git -C "$root" fetch --quiet origin "$DEFAULT_BRANCH" 2>/dev/null; then
    echo "warning: could not fetch origin/${DEFAULT_BRANCH}; publishing without the check." >&2
    return 0
  fi

  local base missing
  base="origin/${DEFAULT_BRANCH}"

  # Files under site/ that differ between this tree and the default branch,
  # limited to those the default branch actually changed (deletions and edits
  # we are missing), rather than local work in progress.
  missing="$(git -C "$root" diff --name-only HEAD "$base" -- site/ 2>/dev/null || true)"

  if [ -z "$missing" ]; then
    echo "site/ matches origin/${DEFAULT_BRANCH}."
    return 0
  fi

  echo >&2
  echo "REFUSING TO PUBLISH: site/ differs from origin/${DEFAULT_BRANCH}." >&2
  echo >&2
  echo "These files differ, and publishing would overwrite the live site with" >&2
  echo "this tree's version of them:" >&2
  echo >&2
  printf '    %s\n' $missing >&2
  echo >&2

  local behind
  behind="$(git -C "$root" rev-list --count "HEAD..$base" 2>/dev/null || echo 0)"
  if [ "$behind" -gt 0 ]; then
    echo "This branch is $behind commit(s) behind origin/${DEFAULT_BRANCH}:" >&2
    git -C "$root" log --oneline "HEAD..$base" 2>/dev/null | sed 's/^/    /' >&2
    echo >&2
    echo "Fix it by catching up first:" >&2
    echo "    git fetch origin && git rebase origin/${DEFAULT_BRANCH}" >&2
  else
    echo "The branch is not behind, so these are probably uncommitted or" >&2
    echo "unmerged local changes. That may be intentional." >&2
  fi

  echo >&2
  echo "To publish anyway: $(basename "${BASH_SOURCE[0]}") --force" >&2
  return 1
}

if [ "$force" -eq 1 ]; then
  echo "warning: --force given, skipping the staleness check." >&2
elif ! stale_check; then
  exit 1
fi

if [ "$check_only" -eq 1 ]; then
  echo "--check given, nothing published."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp -R "$src"/. "$tmp"/

# Cloudflare caches CSS/JS at the edge for four hours, so a plain redeploy would
# keep serving the old files. Stamp each reference with a content hash. This only
# touches the published copy; site/ stays clean for local development.
sha() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -c1-10
  else sha256sum "$1" | cut -c1-10; fi
}

# Discovered rather than listed, so a new stylesheet or script is cache-busted
# automatically instead of silently serving stale for four hours.
for path in "$tmp"/*.css "$tmp"/*.js; do
  [ -f "$path" ] || continue
  asset="$(basename "$path")"
  hash="$(sha "$path")"
  find "$tmp" -name '*.html' -print0 |
    xargs -0 perl -pi -e "s{\Q$asset\E(?=[\"'])}{$asset?v=$hash}g"
  echo "Stamped $asset as $asset?v=$hash"
done

cd "$tmp"
git init -q -b "$BRANCH"
git add -A
git commit -q -m "Publish site/ to $BRANCH"
git remote add origin "https://github.com/$REPO.git"
git push -f origin "$BRANCH"

if command -v gh >/dev/null 2>&1; then
  gh api -X POST "repos/$REPO/pages/builds" >/dev/null
  echo "Pages build queued."
fi

echo "Published $src to $REPO@$BRANCH."
