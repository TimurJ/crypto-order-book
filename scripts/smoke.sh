#!/usr/bin/env bash
#
# smoke.sh — post-deploy health assertions for a crypto-order-book Worker env.
#
# Called by .github/workflows/cd.yml twice per environment: against the version
# PREVIEW URL (before promotion — a broken build never gets promoted) and against
# the LIVE URL (after promotion — confirms the promote actually took). Exits
# non-zero with a ::error:: annotation once the retry deadline below runs out
# with an assertion still failing, so the CD smoke / confirm step fails.
#
# It goes beyond "returns 200": it asserts the security headers from public/_headers
# are present on the document, that the built SPA shell is really being served (a
# stable title marker), and that the RIGHT environment's runtime config is live.
# The six required headers were confirmed served on *.workers.dev before this list
# was fixed (see docs/cd-setup.md); adjust the list here if that ever changes.
#
# The whole assertion set retries with a bounded deadline (SMOKE_ATTEMPTS ×
# SMOKE_RETRY_DELAY, default 6 × 5s): `wrangler versions deploy` returns before
# propagation settles, and in that window a single request can transiently fall
# through to the SPA asset fallback instead of run_worker_first (seen live on
# v1.0.0-rc.1 — docs/cd-setup.md §4 gotcha 10). curl's own --retry can't cover
# this: the fallback answers 200, so only the body assertions catch it. A real
# regression still fails — it just takes the full deadline to report. Intermediate
# attempts print plain messages; ::error:: (a GitHub annotation) only on final
# failure, followed by the last response's headers + body for forensics.
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

# HTTP/2 lowercases header names, so match case-insensitively. These are env-identical constants
# from public/_headers; a missing one is exactly the failure this check exists to catch.
require_header() {
  grep -qiE "^$1:" "$hdr" || { echo "missing header '$1' on $base/"; return 1; }
}

# One full pass over every assertion. Called with its exit status tested, which suspends `set -e`
# for the entire body — so every command that must stop the pass carries an explicit `|| return 1`.
# On failure it echoes a plain one-line message (the caller decides whether it becomes ::error::).
run_checks() {
  # --- Document (/): served by Static Assets, so it carries public/_headers + the SPA shell ---
  # Truncate before every curl: on a failed transfer curl leaves the -o file untouched (only -D is
  # opened eagerly), so without this the final forensic dump could show the PREVIOUS endpoint's body.
  : >"$hdr"; : >"$body"
  curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/" \
    || { echo "curl failed for $base/"; return 1; }

  require_header 'content-security-policy' || return 1
  require_header 'x-content-type-options' || return 1
  require_header 'x-frame-options' || return 1
  require_header 'referrer-policy' || return 1
  require_header 'permissions-policy' || return 1
  require_header 'strict-transport-security' || return 1

  # SPA shell marker — stable across Vite builds (bundle filenames are content-hashed; the title is not).
  grep -qF '<title>Crypto Order Book</title>' "$body" \
    || { echo "SPA shell marker missing on $base/"; return 1; }

  # --- /config.js: Worker-generated (public/_headers can't reach it) — confirms the RIGHT env is live ---
  : >"$hdr"; : >"$body"
  curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/config.js" \
    || { echo "curl failed for $base/config.js"; return 1; }
  grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
    || { echo "missing nosniff on $base/config.js"; return 1; }
  grep -qF "\"env\":\"$env\"" "$body" \
    || { echo "/config.js env mismatch: expected \"env\":\"$env\" at $base"; return 1; }

  # --- /api/health: the Worker's first /api/* route (run_worker_first), consumed by the SPA's ---
  # --- health query — asserts the API namespace is really routed to the Worker, per env      ---
  : >"$hdr"; : >"$body"
  curl "${curl_opts[@]}" -D "$hdr" -o "$body" "$base/api/health" \
    || { echo "curl failed for $base/api/health"; return 1; }
  grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
    || { echo "missing nosniff on $base/api/health"; return 1; }
  grep -qF '"status":"ok"' "$body" \
    || { echo "/api/health not ok at $base"; return 1; }
  grep -qF "\"env\":\"$env\"" "$body" \
    || { echo "/api/health env mismatch: expected \"env\":\"$env\" at $base"; return 1; }

  # --- unmatched /api/*: the Worker must answer the whole worker-first namespace itself with a ---
  # --- JSON 404 — never fall through to the SPA fallback's index.html at 200                   ---
  # No --fail here: 404 is the EXPECTED status, and --fail would abort on it (exit 22). -D captures
  # the headers so we can assert nosniff too — the 404 runs through noStoreResponse like the others.
  : >"$hdr"; : >"$body"
  code="$(curl -sS --retry 3 --retry-delay 3 -D "$hdr" -o "$body" -w '%{http_code}' "$base/api/__smoke_not_found__")" \
    || { echo "curl failed for unmatched /api/* at $base"; return 1; }
  [ "$code" = "404" ] \
    || { echo "expected 404 for unmatched /api/* at $base (got $code)"; return 1; }
  grep -qiE '^x-content-type-options: *nosniff' "$hdr" \
    || { echo "missing nosniff on unmatched /api/* at $base"; return 1; }
  grep -qF '"error":"not_found"' "$body" \
    || { echo "unmatched /api/* body missing \"error\":\"not_found\" at $base"; return 1; }
}

attempts="${SMOKE_ATTEMPTS:-6}"
delay="${SMOKE_RETRY_DELAY:-5}"
msg="smoke ran zero attempts (SMOKE_ATTEMPTS=$attempts)"
for ((i = 1; i <= attempts; i++)); do
  if msg="$(run_checks)"; then
    echo "Smoke OK ($env): $base"
    exit 0
  fi
  if ((i < attempts)); then
    echo "attempt $i/$attempts: $msg — retrying in ${delay}s"
    sleep "$delay"
  fi
done
echo "::error::$msg (still failing after $attempts attempts)"
echo "--- last response headers ---"; cat "$hdr"
echo "--- last response body (first 20 lines) ---"; head -20 "$body"; echo
exit 1
