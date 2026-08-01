#!/usr/bin/env bash
#
# branch-sweep.sh — classify every local branch by the fate of its GitHub PR, then delete
# (after a confirmation) only the ones whose content provably landed on main. Run it
# manually when local branches pile up; it never runs on a schedule and never touches main.
#
# Usage:  pnpm sweep [--dry-run] [--yes]
#
#   pnpm sweep              report, then prompt before deleting the SAFE set
#   pnpm sweep --dry-run    report only
#   pnpm sweep --yes        report and delete without prompting
#
# Classes (only SAFE is ever deleted):
#   SAFE              PR merged into main AND local tip == the PR's head SHA — content is on
#                     main, byte-for-byte
#   AHEAD             PR merged but local tip differs — local-only commits exist; inspect by hand
#   MERGED-ELSEWHERE  PR merged into a branch other than main — not provably on main; inspect
#   CLOSED            PR closed without merging — may hold the only copy of unpushed work
#   ACTIVE            PR still open
#   LOCAL-ONLY        no PR ever opened for this branch
#   CURRENT           the branch checked out here — never classified; git can't delete it anyway
#
# This repo squash-merges, so `git branch -d`'s ancestry check can never pass and is no
# protection; the SAFE criterion (PR state + base + head SHA match via `gh`) replaces it. Each
# queued tip is re-verified immediately before deletion — a branch that moved while the prompt
# sat is reported RACED and kept. Deleted tips stay recoverable: git prints `(was <sha>)` per
# deletion, and GitHub keeps `refs/pull/<N>/head` for every PR head ever pushed. Full
# rationale: docs/branch-sweep-setup.md.
set -euo pipefail

usage="usage: pnpm sweep [--dry-run] [--yes]"
dry="" assume_yes=""
for a in "$@"; do
  case "$a" in
    -n | --dry-run | --dry) dry=1 ;;
    -y | --yes) assume_yes=1 ;;
    *)
      echo "sweep: unknown argument '$a'" >&2
      echo "$usage" >&2
      exit 2
      ;;
  esac
done

command -v gh > /dev/null || {
  echo "sweep: gh is required (classification is by PR state)" >&2
  exit 1
}

git fetch --prune --quiet
ahead=$(git rev-list --count origin/main..main)
behind=$(git rev-list --count main..origin/main)
echo "main: ${ahead} ahead, ${behind} behind origin/main (sweep never touches main; sync it with 'git pull --ff-only')"
echo

current=$(git branch --show-current)
safe=()
while IFS= read -r branch; do
  [ "$branch" = "main" ] && continue
  if [ "$branch" = "$current" ]; then
    printf 'CURRENT     %-55s checked out here — skipped\n' "$branch"
    continue
  fi
  # refs/heads/ is exact — a bare name is shadowed by a same-named tag in rev-parse's ref order
  tip=$(git rev-parse --verify "refs/heads/$branch")
  # newest PR wins: a head name reused across PRs must be judged by its latest PR only.
  # </dev/null: the loop's stdin is the branch list — gh must never get a chance to eat it
  pr=$(gh pr list --head "$branch" --state all --limit 20 --json number,state,headRefOid,baseRefName \
    --jq 'sort_by(.number) | last // empty | "\(.number)\t\(.state)\t\(.headRefOid)\t\(.baseRefName)"' \
    < /dev/null)
  if [ -z "$pr" ]; then
    printf 'LOCAL-ONLY  %-55s no PR — skipped\n' "$branch"
    continue
  fi
  num=$(printf '%s' "$pr" | cut -f1)
  state=$(printf '%s' "$pr" | cut -f2)
  oid=$(printf '%s' "$pr" | cut -f3)
  base=$(printf '%s' "$pr" | cut -f4)
  case "$state" in
    OPEN)
      printf 'ACTIVE      %-55s PR #%s open — skipped\n' "$branch" "$num"
      ;;
    MERGED)
      # MERGED means merged into the PR's base — only base main proves the content landed on main
      if [ "$base" != "main" ]; then
        printf 'MERGED-ELSEWHERE  %-49s PR #%s merged into %s, not main — inspect by hand\n' \
          "$branch" "$num" "$base"
      elif [ "$tip" = "$oid" ]; then
        printf 'SAFE        %-55s PR #%s merged, tip matches PR head\n' "$branch" "$num"
        safe+=("$branch"$'\t'"$tip")
      else
        printf 'AHEAD       %-55s PR #%s merged but tip %.9s != PR head %.9s — local-only commits, inspect by hand\n' \
          "$branch" "$num" "$tip" "$oid"
      fi
      ;;
    CLOSED)
      printf 'CLOSED      %-55s PR #%s closed UNMERGED — may be the only copy; keep, or archive then delete:\n' "$branch" "$num"
      printf '            git tag "archive/%s" "%s" && git branch -D "%s"\n' "$branch" "$branch" "$branch"
      ;;
    *)
      printf 'UNKNOWN     %-55s PR #%s state %s — skipped\n' "$branch" "$num" "$state"
      ;;
  esac
# lstrip=2, not :short — :short disambiguates to heads/<name> when a tag shares the branch's
# name, which breaks the refs/heads/$branch concatenation above; lstrip=2 is always the exact name
done < <(git for-each-ref refs/heads --format='%(refname:lstrip=2)')

echo
if [ "${#safe[@]}" -eq 0 ]; then
  echo "sweep: nothing safe to delete"
  exit 0
fi

echo "safe to delete (${#safe[@]}):"
for entry in "${safe[@]}"; do
  echo "  git branch -D \"${entry%%$'\t'*}\""
done

[ -n "$dry" ] && exit 0

if [ -z "$assume_yes" ]; then
  printf 'delete these %s branches? [y/N] ' "${#safe[@]}"
  # || : EOF on a non-tty stdin must land in the clean abort path, not a bare set -e exit
  read -r reply || reply=""
  case "$reply" in
    y | Y | yes) ;;
    *)
      echo "sweep: aborted, nothing deleted"
      exit 0
      ;;
  esac
fi

delete_failed=""
for entry in "${safe[@]}"; do
  branch=${entry%%$'\t'*}
  tip=${entry#*$'\t'}
  # re-verify the tip right before deleting: a commit made while the prompt sat (another
  # terminal, an IDE) must demote the branch, not vanish with it
  if [ "$(git rev-parse --verify "refs/heads/$branch" 2> /dev/null)" = "$tip" ]; then
    git branch -D "$branch" || {
      delete_failed=1
      printf 'FAILED      %-55s git branch -D refused — see error above\n' "$branch"
    }
  else
    printf 'RACED       %-55s tip moved or branch already gone since classification — kept, re-run to reclassify\n' "$branch"
  fi
done

# the if form, not `[ … ] && exit 1` — as the script's last command that list would exit 1
# on the success path too
if [ -n "$delete_failed" ]; then
  exit 1
fi
