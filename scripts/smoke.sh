#!/usr/bin/env bash
#
# smoke.sh — post-deploy health assertions for a crypto-order-book Worker env.
#
# Called by .github/workflows/cd.yml twice per environment: against the version
# PREVIEW URL (before promotion — a broken build never gets promoted) and against
# the LIVE URL (after promotion — confirms the promote actually took). Exits
# non-zero with a ::error:: annotation on the first failed assertion so the CD
# smoke / confirm step fails.
#
# It goes beyond "returns 200": it asserts the security headers from public/_headers
# are present on the document, that the built SPA shell is really being served (a
# stable title marker), and that the RIGHT environment's runtime config is live.
# The six required headers were confirmed served on *.workers.dev before this list
# was fixed (see docs/cd-setup.md); adjust the list here if that ever changes.
#
# Usage:  bash scripts/smoke.sh <base-url> <env>
#   <base-url>  origin to probe, e.g. https://…workers.dev (trailing slash tolerated)
#   <env>       expected APP_ENV: dev | uat | prod (asserted in the /config.js body)
set -euo pipefail

usage="usage: bash scripts/smoke.sh <base-url> <env>"
base="${1:?$usage}"; base="${base%/}"
env="${2:?$usage}"

# Matches the previous inline smoke: fail on HTTP >= 400, retry transient/edge blips, quiet-but-loud.
curl_opts=(--fail --retry 3 --retry-delay 3 --retry-all-errors -sS)
hdr="$(mktemp)"; body="$(mktemp)"; trap 'rm -f "$hdr" "$body"' EXIT

# --- Document (/): served by Static Assets, so it carries public/_headers + the SPA shell ---
curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/"

# HTTP/2 lowercases header names, so match case-insensitively. These are env-identical constants
# from public/_headers; a missing one is exactly the failure this check exists to catch.
require_header() {
  grep -qiE "^$1:" "$hdr" || { echo "::error::missing header '$1' on $base/"; exit 1; }
}
require_header 'content-security-policy'
require_header 'x-content-type-options'
require_header 'x-frame-options'
require_header 'referrer-policy'
require_header 'permissions-policy'
require_header 'strict-transport-security'

# SPA shell marker — stable across Vite builds (bundle filenames are content-hashed; the title is not).
grep -qF '<title>Crypto Order Book</title>' "$body" \
  || { echo "::error::SPA shell marker missing on $base/"; exit 1; }

# --- /config.js: Worker-generated (public/_headers can't reach it) — confirms the RIGHT env is live ---
curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/config.js"
grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
  || { echo "::error::missing nosniff on $base/config.js"; exit 1; }
grep -qF "\"env\":\"$env\"" "$body" \
  || { echo "::error::/config.js env mismatch: expected \"env\":\"$env\" at $base"; exit 1; }

# --- /api/health: the Worker's first /api/* route (run_worker_first), consumed by the SPA's ---
# --- health query — asserts the API namespace is really routed to the Worker, per env      ---
curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/api/health"
grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
  || { echo "::error::missing nosniff on $base/api/health"; exit 1; }
grep -qF '"status":"ok"' "$body" \
  || { echo "::error::/api/health not ok at $base"; exit 1; }
grep -qF "\"env\":\"$env\"" "$body" \
  || { echo "::error::/api/health env mismatch: expected \"env\":\"$env\" at $base"; exit 1; }

# --- unmatched /api/*: the Worker must answer the whole worker-first namespace itself with a ---
# --- JSON 404 — never fall through to the SPA fallback's index.html at 200                   ---
# No --fail here: 404 is the EXPECTED status, and --fail would abort on it (exit 22). -D captures
# the headers so we can assert nosniff too — the 404 runs through noStoreResponse like the others.
code="$(curl -sS --retry 3 --retry-delay 3 -D "$hdr" -o "$body" -w '%{http_code}' "$base/api/__smoke_not_found__")"
[ "$code" = "404" ] \
  || { echo "::error::expected 404 for unmatched /api/* at $base (got $code)"; exit 1; }
grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
  || { echo "::error::missing nosniff on unmatched /api/* at $base"; exit 1; }
grep -qF '"error":"not_found"' "$body" \
  || { echo "::error::unmatched /api/* body missing \"error\":\"not_found\" at $base"; exit 1; }

echo "Smoke OK ($env): $base"
