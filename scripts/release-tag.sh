#!/usr/bin/env bash
#
# release-tag.sh — compute the next version tag off the latest release, run preflight
# checks that mirror the CD pipeline's own preconditions, then (after a confirmation)
# create and push it. Pushing the tag is what triggers the Cloudflare deploy via
# .github/workflows/cd.yml:
#
#   vX.Y.Z         -> PROD (approval-gated)
#   vX.Y.Z-rc.N    -> UAT
#
# Usage:  pnpm release <patch|minor|major> [rc] [--dry-run] [--yes] [--allow-no-rc]
#
#   pnpm release patch        v0.1.0 -> v0.1.1        (PROD)
#   pnpm release minor        v0.1.0 -> v0.2.0        (PROD)
#   pnpm release major        v0.1.0 -> v1.0.0        (PROD)
#   pnpm release patch rc     v0.1.0 -> v0.1.1-rc.1   (UAT; rc.N auto-increments)
#   pnpm release minor --dry-run                      (preview + preflight, no tag/push)
#
# You always choose the bump — this never guesses it from commit messages. The next version
# is computed off the latest RELEASE tag (after fetching), the same baseline cd.yml's monotonic
# gate uses, so the tag it produces always passes. A final release only pins to an rc that's on
# origin — proof it actually deployed to UAT.
#
# A FINAL release pins to the exact commit the tested rc points to (build-once-promote:
# PROD ships byte-for-byte what UAT signed off), and attaches auto-generated release
# notes via `gh` (best-effort — the deploy never depends on gh).
set -euo pipefail

usage="usage: pnpm release <patch|minor|major> [rc] [--dry-run] [--yes] [--allow-no-rc]"
part="" rc="" dry="" assume_yes="" allow_no_rc=""
for a in "$@"; do
  case "$a" in
    patch | minor | major) part="$a" ;;
    rc) rc=1 ;;
    -n | --dry-run | --dry) dry=1 ;;
    -y | --yes) assume_yes=1 ;;
    --allow-no-rc) allow_no_rc=1 ;;
    *)
      echo "release: unknown argument '$a'" >&2
      echo "$usage" >&2
      exit 2
      ;;
  esac
done
if [ -z "$part" ]; then
  echo "$usage" >&2
  exit 2
fi

# --- Read remote truth: the CI gate compares against tags on the remote. --------------
git fetch --tags --quiet origin ||
  {
    echo "release: 'git fetch' failed — can't verify the latest tags. Check your connection." >&2
    exit 1
  }

# --- Compute the next version off the latest RELEASE tag (vX.Y.Z, no -rc). -------------
latest=$(git tag -l | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
latest=${latest:-v0.0.0}
IFS=. read -r cur_major cur_minor cur_patch <<<"${latest#v}"
cur_major=$((10#$cur_major)) cur_minor=$((10#$cur_minor)) cur_patch=$((10#$cur_patch))
case "$part" in
  major) core="v$((cur_major + 1)).0.0" ;;
  minor) core="v${cur_major}.$((cur_minor + 1)).0" ;;
  patch) core="v${cur_major}.${cur_minor}.$((cur_patch + 1))" ;;
esac

# Highest existing rc number for this core (empty if none).
max_rc=$(git tag -l "${core}-rc.*" | sed -E 's/.*-rc\.//' | sort -n | tail -1 || true)

# --- Resolve the tag + the target commit that will actually be promoted. --------------
head=$(git rev-parse HEAD)
pin_note=""
warn_fallback=""
fail_no_rc=""
fail_local_rc=""
target="$head" # rc, and a final release with no candidate to pin, both tag the current main tip
if [ -n "$rc" ]; then
  tag="${core}-rc.$((${max_rc:-0} + 1))"
  channel="UAT"
else
  tag="$core"
  channel="PROD (approval-gated)"
  if [ -n "$max_rc" ]; then
    # Pin the final release to the last tested candidate's commit — but only if that rc is on
    # origin (i.e. it really deployed to UAT); a local-only rc never ran through UAT.
    pinned_rc="${core}-rc.${max_rc}"
    if git ls-remote --exit-code origin "refs/tags/${pinned_rc}" >/dev/null 2>&1; then
      target=$(git rev-list -n1 "$pinned_rc")
      pin_note="pinned to ${pinned_rc} (latest rc deployed to UAT)"
    else
      fail_local_rc="highest rc ${pinned_rc} exists only locally, not on origin — it never deployed to UAT (orphaned/interrupted push?). Delete it (git tag -d ${pinned_rc}) or push it, then retry."
    fi
  elif [ -n "$allow_no_rc" ]; then
    warn_fallback="no ${core}-rc.* found — tagging main HEAD (--allow-no-rc: promoting a commit UAT never signed off)"
  else
    fail_no_rc="no ${core}-rc.* for ${core} — nothing UAT-tested to promote. Cut 'pnpm release ${part} rc' first, or pass --allow-no-rc to ship main HEAD."
  fi
fi
target_short=$(git rev-parse --short "$target")

# --- Preflight: validate the TARGET commit (the bytes that get promoted). -------------
echo "Preflight:"
blocking=0
ok() { printf '  [ok]   %s\n' "$1"; }
bad() {
  printf '  [FAIL] %s\n' "$1"
  blocking=$((blocking + 1))
}
warn() { printf '  [warn] %s\n' "$1"; }

[ -n "$warn_fallback" ] && warn "$warn_fallback"
[ -n "$fail_no_rc" ] && bad "$fail_no_rc"
[ -n "$fail_local_rc" ] && bad "$fail_local_rc"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "main" ]; then
  ok "on main"
else
  bad "on '$branch', not main — release from the main tip"
fi

if [ "$head" = "$(git rev-parse origin/main)" ]; then
  ok "up to date with origin/main"
else
  bad "HEAD != origin/main ($(git rev-parse --short origin/main)) — pull/merge first"
fi

if git merge-base --is-ancestor "$target" origin/main 2>/dev/null; then
  ok "target ${target_short} is on main"
else
  bad "target ${target_short} is not on origin/main — can't promote a commit main never built"
fi

if command -v gh >/dev/null 2>&1; then
  runs=$(gh run list --workflow cd.yml --commit "$target" --branch main --limit 20 \
    --json status,conclusion \
    --jq '[.[] | select(.status=="completed" and .conclusion=="success")] | length' 2>/dev/null || echo "?")
  # 'dist-<sha>' must match the artifact name cd.yml's build job uploads (name: dist-${github.sha}).
  art=$(gh api "repos/{owner}/{repo}/actions/artifacts?name=dist-$target" \
    --jq '[.artifacts[] | select(.expired==false)] | length' 2>/dev/null || echo "?")
  if [ "$runs" = "1" ] && [ "$art" = "1" ]; then
    ok "build ready — 1 successful main run, live artifact dist-${target_short}"
  elif [ "$runs" = "?" ] || [ "$art" = "?" ]; then
    warn "couldn't reach GitHub (gh) — skipping the build-artifact check (CI still enforces it)"
  else
    bad "no promotable artifact for ${target_short} (successful main runs: $runs, live artifacts: $art) — let the main build finish"
  fi
else
  warn "gh not installed — skipping the build-artifact check (CI still enforces it)"
fi

printf '\n  next tag:  %s\n  target:    %s  %s\n  deploys:   %s\n' \
  "$tag" "$target_short" "$(git log -1 --format=%s "$target")" "$channel"
[ -n "$pin_note" ] && printf '  note:      %s\n' "$pin_note"
printf '\n'

if [ -n "$dry" ]; then
  echo "(dry-run) would run: git tag -a $tag $target_short -m $tag && git push origin $tag"
  [ "$blocking" -gt 0 ] && echo "(dry-run) note: $blocking blocking issue(s) above would prevent a real run."
  exit 0
fi

if [ "$blocking" -gt 0 ]; then
  echo "release: $blocking blocking issue(s) above — not tagging." >&2
  exit 1
fi

if [ -z "$assume_yes" ]; then
  printf 'Create and push %s (triggers %s)? [y/N] ' "$tag" "$channel"
  read -r reply
  case "$reply" in
    y | Y | yes | YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

git tag -a "$tag" "$target" -m "$tag"
git push origin "$tag" || {
  echo "release: push failed — removing the local tag so the next run recomputes cleanly." >&2
  git tag -d "$tag" >/dev/null 2>&1 || true
  exit 1
}
echo "Pushed $tag -> $target_short."

# Final releases: attach an audit-trail GitHub Release with auto-generated notes. The tag
# is already pushed (deploy already triggered), so this is strictly best-effort.
if [ -z "$rc" ]; then
  if command -v gh >/dev/null 2>&1; then
    if gh release create "$tag" --verify-tag --generate-notes --title "$tag"; then
      echo "Created GitHub Release $tag with generated notes."
    else
      echo "warn: 'gh release create' failed — tag is pushed and PROD will deploy; create the Release/notes manually if needed." >&2
    fi
  else
    echo "warn: gh not installed — skipped release notes; tag is pushed and PROD will deploy." >&2
  fi
fi

echo "Watch: gh run watch \$(gh run list --workflow cd.yml -L1 --json databaseId --jq '.[0].databaseId')"
