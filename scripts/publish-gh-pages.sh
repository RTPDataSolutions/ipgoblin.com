#!/usr/bin/env bash
# Publish site/ to the gh-pages branch and trigger a GitHub Pages build.
#
# This is the fallback for when GitHub Actions is unavailable (for example while
# the organisation account is locked for billing). When Actions is working again,
# switch Pages back to the workflow build and let .github/workflows/pages.yml do
# this automatically:
#
#   gh api -X PUT repos/RTPDataSolutions/ipgoblin.com/pages -f build_type=workflow

set -euo pipefail

REPO="RTPDataSolutions/ipgoblin.com"
BRANCH="gh-pages"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/site"

[ -d "$src" ] || { echo "error: $src not found" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp -R "$src"/. "$tmp"/

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
