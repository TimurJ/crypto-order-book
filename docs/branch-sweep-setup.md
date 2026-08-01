# Branch sweep — manual local-branch cleanup

`scripts/branch-sweep.sh` (`pnpm sweep`) classifies every local branch by the fate of its GitHub PR
and deletes, after a confirmation, only the ones whose content provably landed on `main`. It is a
manual housekeeping tool: run it when the local branch list gets out of hand, read the report, confirm.
Nothing schedules it and it never touches `main` (it reports main's ahead/behind and leaves syncing to
`git pull --ff-only`).

## 1. Usage

```
pnpm sweep              # report, then y/N prompt before deleting the SAFE set
pnpm sweep --dry-run    # report only
pnpm sweep --yes        # report and delete without prompting
```

Requires `gh` (authenticated) — classification is by PR state, which git alone cannot see.

## 2. Why a manual script, not automation

The popular one-liner — *delete every branch whose upstream is `[gone]`* — is unsafe here, because
"gone" conflates two opposite events:

- PR **merged** → GitHub auto-deleted the head branch → safe to delete locally.
- PR **closed without merging** → GitHub deleted the head branch too → the local branch is now **the
  only copy of any unpushed commits and the only convenient copy of the rest** (the pushed tip
  survives only as the obscure `refs/pull/<N>/head`, see §4) — and the script just deleted it.

Both look identical to git. Only the PR record distinguishes them, so the sweep asks GitHub and keeps
the human on the trigger. This was observed for real, not hypothetically: at the first sweep
(2026-08-01), `dependabot/npm_and_yarn/production-dependencies-0534aef19d` sat locally with its remote
gone — its PR #45 was **closed unmerged**, superseded by the regenerated PR #52. A `[gone]`-based
cleanup would have deleted it on the same pass as the eight merged branches, unexamined.

## 3. Why ancestry can't be the safety check (squash merges)

`git branch -d` refuses to delete a branch that isn't an ancestor of `main` — that's git's built-in
guard. Squash merging (the only merge strategy here, see `docs/ci-setup.md`) rewrites every PR into a
new commit, so **no** feature branch is ever an ancestor of `main` and `-d` refuses even for fully
landed work. Everyone then reaches for `-D`, which deletes anything without question. The sweep
re-establishes the lost guarantee with PR evidence instead of ancestry:

| Class | Criterion | Action |
|---|---|---|
| **SAFE** | PR `MERGED` into `main` **and** local tip == PR `headRefOid` | queued; deleted on confirm |
| **AHEAD** | PR `MERGED` into `main` but tips differ | report both SHAs — local-only commits exist |
| **MERGED-ELSEWHERE** | PR `MERGED` into a base other than `main` | report only — on the base branch, not provably on `main` |
| **CLOSED** | PR closed unmerged | report + archive recipe; never deleted |
| **ACTIVE** | PR open | skipped |
| **LOCAL-ONLY** | no PR for this head | skipped |

SAFE is three conditions because `MERGED` alone proves the wrong things. The tip == `headRefOid`
check catches the subtler failure: a PR merges, then a commit is added to the same local branch and
forgotten — "PR merged → delete" would discard it; the SHA comparison demotes it to AHEAD. The
base == `main` check closes the stacked-PR hole: `MERGED` means merged into *the PR's base*, so a
branch merged into another feature branch would otherwise pass both other conditions without its
content ever having landed on `main`.

## 4. Recovery story

Deleting a branch deletes a pointer, not commits — but `git branch -D` deletes the branch's **own
reflog with it**, so the nets are what remains, strongest first:

- GitHub keeps `refs/pull/<N>/head` at the PR's final head SHA even after deleting the head branch
  (verified against closed PR #45 after its branch was gone). Everything the sweep deletes had a PR by
  construction, so `git fetch origin refs/pull/<N>/head` recovers any swept tip regardless of local
  state. Observed, reliable GitHub behavior — not a documented guarantee, hence the nets below.
- git prints `Deleted branch X (was <sha>)` per deletion — that SHA restores the branch outright
  (`git branch X <sha>`).
- **HEAD's** reflog holds the tips of branches that were checked out here, ~30 days for unreachable
  entries (`gc.reflogExpireUnreachable`). That covers branches born via `git switch` or
  `gh pr checkout`; one created without a checkout (`git fetch origin x:x`) leaves no HEAD entries,
  and its deleted tip survives only until gc prunes unreachable objects (`gc.pruneExpire`, ~2 weeks).

For a CLOSED branch you want out of the list but not lost, the report prints the archive recipe:
`git tag archive/<name> <name> && git branch -D <name>` — the tag keeps the tip reachable forever
without branch clutter.

## 5. Gotchas

- **Deletion re-checks the tip:** classification and the y/N answer can be minutes apart, and a
  commit made meanwhile (another terminal, an IDE) would be deleted unverified — the AHEAD case,
  raced. The delete loop re-resolves each branch and deletes only on an exact match with the
  classified tip; otherwise it prints `RACED` and keeps the branch. The re-check + `git branch -D`
  was chosen over the atomic `git update-ref -d <ref> <old-sha>` deliberately: `update-ref` verifies
  the old value but skips `-D`'s refusal to delete a branch checked out in another worktree (tested —
  it orphans that worktree's HEAD), leaves `branch.<name>.*` config behind, and prints no
  `(was <sha>)` breadcrumb.
- **Tag shadowing is guarded at both steps.** Resolution uses `refs/heads/<name>`, never a bare
  name — a tag sharing a branch's name shadows it in `rev-parse`'s resolution order (tags win),
  which would compare the tag's OID instead. Enumeration uses `%(refname:lstrip=2)`, not
  `%(refname:short)` — `:short` disambiguates against a same-named tag to `heads/<name>`, which
  the `refs/heads/` concatenation then fails to resolve, crashing the sweep mid-report.
- **Reused head names:** a branch name recycled across PRs gets multiple PR records; the sweep judges
  by the **highest-numbered** (newest) PR only.
- **`gh pr list --head` matches by name**, so a local branch that was never pushed simply has no PR
  and lands in LOCAL-ONLY — the sweep cannot mistake it for merged.
- **The checked-out branch is reported as `CURRENT`, never classified** — `git branch -D` refuses to
  delete it anyway, and printing the line (rather than skipping silently) keeps the report a complete
  inventory of local branches. Non-tty stdin is handled too: EOF at the y/N prompt takes the clean
  "aborted, nothing deleted" path instead of a bare `set -e` exit.
- **`git fetch --prune` is folded into the sweep**, so stale `origin/*` tracking refs clear on every
  run and no `fetch.prune` git config is needed (that config would also be machine-local, which
  tracked repo files can't assume).
- **Empty-array expansion under `set -u`:** the SAFE list is only ever expanded after the
  zero-length early-exit — bash 3.2 (macOS default) errors on `"${arr[@]}"` when the array is empty.

## 6. Reuse recipe

For any repo that squash-merges and auto-deletes head branches: copy `scripts/branch-sweep.sh`, keep
the three-part SAFE criterion (PR `MERGED` via `gh`, base == the default branch, tip ==
`headRefOid`), keep the pre-delete tip re-check, keep CLOSED as report-only, and keep the
confirmation prompt — the value of the tool is that deletion stays a human decision made against
gathered evidence, not a heuristic. First run of this script here swept 8 SAFE branches and
correctly refused the 1 CLOSED one (see §2).
