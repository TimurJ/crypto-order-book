# Dependency automation setup — Dependabot

A chronicle of how automated dependency updates were added to `crypto-order-book`, the two existing
gates Dependabot collided with, and how each was resolved. Companion to [`ci-setup.md`](ci-setup.md)
and [`cd-setup.md`](cd-setup.md). README has the how-to; CLAUDE.md has the short rationale; this is the
full story.

> Config lives in [`.github/dependabot.yml`](../.github/dependabot.yml). Two ecosystems: **npm** (the
> pnpm app deps) and **github-actions** (the SHA-pinned actions in `ci.yml` / `cd.yml` — on a bump
> Dependabot rewrites both the commit SHA and its `# vX.Y.Z` comment).

---

## 1. Goals & why these choices

- **Keep deps and pinned actions current automatically**, with a scheduled, reviewable surface for
  security patches — the repo had *no* dependency automation before this.
- **Dependabot over Renovate.** Both are industry standard; they sit at different points on a
  simplicity↔power axis. Dependabot is the **native, zero-infra baseline** — a single checked-in config
  file, no GitHub App to install, native Security-tab integration. It matches this repo's deliberately
  GitHub-Actions-first posture (gitleaks-action, commitlint-action, wrangler-via-devDep). Renovate is the
  power-user tool you graduate to for monorepos or surgical control; this isn't really a monorepo
  (`pnpm-workspace.yaml` has `packages: []`), so its edge cases don't apply. Learn the baseline first;
  switching later is a contained change.
- **Properly integrated, not just dropped in.** Dependabot collides with two of this repo's gates
  (§4). "Setup properly" means handling both so Dependabot PRs are green and mergeable.

## 2. Architecture decisions (the locked forks)

- **One config, two ecosystems.** `npm` is the `package-ecosystem` identifier for **pnpm** too
  (Dependabot detects pnpm from `pnpm-lock.yaml`). `github-actions` with `directory: "/"` covers
  everything under `.github/workflows/`.
- **Grouped non-majors, individual majors.** Two groups per `dependency-type` (production /
  development) batch `minor`+`patch` into ≤2 PRs/week. **Majors are intentionally ungrouped** — each
  breaking change gets its own PR so it's reviewed and CI-tested in isolation. Actions are grouped into
  a single PR (`patterns: ["*"]` — low volume, low risk).
- **One `ignore` rule: `@types/node` majors.** `@types/node`'s major must track the **Node runtime**
  major (locked to 24 — `.nvmrc` + the `engines.node` gate in `package.json`; see
  [`ci-setup.md`](ci-setup.md)). A v26 bump on Node 24 would let code typecheck against APIs the runtime
  lacks — green CI, then a runtime crash. So `update-types: ["version-update:semver-major"]` is ignored
  for `@types/node` **only**; 24.x minor/patch still flow (grouped as dev deps). A deliberate exception to
  "individual majors" above — lift it (and bump `.nvmrc` + `engines`) together at the next Node LTS.
  Prompted by Dependabot PR #13 (`@types/node` 24 → 26).
- **`commit-message.prefix` is load-bearing** (see §4). `chore` for npm, `ci` for actions, both with
  `include: "scope"`.
- **`versioning-strategy: increase`.** This is an **application** (`"private": true`, deployed SPA) with
  a committed lockfile and a mix of exact-pinned (`@biomejs/biome`, `vitest`, …) and caret deps. `increase`
  bumps the manifest version explicitly and deterministically — exact pins stay exact, carets stay carets,
  only the number moves. (`increase-if-necessary` is the lower-churn alternative if you'd rather only touch
  the manifest when a lockfile-only bump wouldn't satisfy the range; `auto` is the default we chose against
  for determinism.)
- **Cooldown (7 days) on both ecosystems** (see §4.5 — actions supports `default-days`, not the
  semver-level keys).

## 3. What was built, file by file

| File | Change |
|---|---|
| `.github/dependabot.yml` | **New.** The config above. |
| `.github/dependabot.yml` (`ignore`) | **Added later.** `@types/node` semver-major ignored — pins the types to the enforced Node 24 runtime (§2). |
| `package.json` (`commitlint` block) | Added `rules` disabling `body-max-line-length` + `footer-max-line-length` (§4.1). |
| `.github/workflows/cd.yml` (`preview` job) | Added `github.actor != 'dependabot[bot]'` to the `if` (§4.2). |
| `README.md` / `CLAUDE.md` / `docs/production-readiness.md` | Docs kept in sync; #6 checked off. |

## 4. Gotchas hit & how they were fixed

These are the reason this was more than a one-file PR. Both were verified against current GitHub docs +
dependabot-core before writing the config.

### 4.1 commitlint would block every Dependabot PR

`@commitlint/config-conventional` sets **`body-max-line-length: 100`** at *error* level. Dependabot's
commit **bodies** routinely exceed it — the `Bumps [pkg](long-url) from x to y.` line and the
`- [Commits](long-url)` bullets blow past 100 chars for any scoped package or long repo path. Because
**"Commit messages (commitlint)" is a required branch-protection check**, those PRs would be **blocked
from merging**. (Long-standing: dependabot-core #2445, #5923.)

**Fix (chosen):** relax the two length rules in the `package.json` `commitlint` block:

```json
"commitlint": {
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"]
  }
}
```

Smallest change, stays in `package.json` (both the local `commit-msg` hook and the CI `commits` job
auto-discover it). **Tradeoff:** human commits also lose body/footer line-length enforcement — a
deliberately low-value rule (it conflicts with pasting URLs/stack traces too). Everything that matters
for readable history stays strict: `type-enum`, `scope`, `subject-case`, `subject-full-stop`, and
**`header-max-length: 100`**.

*Alternatives considered:* a JS commitlint config with `ignores: [(m) => m.includes("dependabot[bot]")]`
(surgical, preserves human rules, but migrates config out of `package.json`); or skipping the `commits`
job for the bot (`if: github.actor != 'dependabot[bot]'` — a job-level skip reports *success* to a
required check, so it's safe, but Dependabot commits go unvalidated and it leans on subtle skip-semantics).

### 4.2 The CD preview job would red-X on Dependabot PRs

Since **2021-03-01**, workflows triggered by Dependabot run with a **read-only token and no access to
Actions secrets** (only Dependabot secrets) — a guard against a compromised dependency exfiltrating
secrets. The CD `preview` job runs `wrangler versions upload`, which needs `CLOUDFLARE_API_TOKEN`. Its
`if` already excludes forks, but Dependabot pushes branches to the **same repo**, so it *would* match —
and the upload would fail (the `| tee` pipeline fails under the runner's default `pipefail`), painting a
red X on every Dependabot PR. Non-blocking (CD checks aren't required) but noisy and misleading.

**Fix:** add `&& github.actor != 'dependabot[bot]'` to the preview job's `if`. A dependency bump needs no
visual preview; the job now **skips** (not fails) on Dependabot PRs, with no token exposure. *(Alternative:
store `CLOUDFLARE_API_TOKEN` as a Dependabot secret so the preview deploys on bot PRs too — more setup +
exposes the dev token to Dependabot-triggered runs; declined.)*

### 4.3 The load-bearing `prefix` — exact mechanism

Dependabot's default subject verb is **capitalised** (`Bump …`). With a prefix that becomes
`chore(deps): Bump …`, which fails config-conventional's **`subject-case`** rule (verified locally:
`✖ subject must not be sentence-case…`); with *no* prefix the bare `Bump …` fails **`type-empty`** instead
— either way a required rule fails. The fix is to make Dependabot emit a lowercase verb, and the precise
mechanism matters (the issue history is noisy with people getting `Bump` *despite* a prefix):
Dependabot (`pr_name_prefixer.rb`) capitalises the first word **only when the configured prefix's first
character is *not* lowercase**, short-circuiting *before* the flaky last-commit-style heuristic ever runs.
Our prefixes (`chore`, `ci`) start lowercase, so the verb is **deterministically** `bump`, regardless of
commit history. → `chore(deps): bump …` / `ci(deps): bump …` pass. **Do not remove the prefix.**

### 4.4 Grouped-subject length is a non-issue

Grouped PRs use the phrasing `bump the <group> group across N directory/directories with N update(s)`.
Worst case here — `chore(deps-dev): bump the development-dependencies group across 1 directory with N
updates` — is **≈90 chars**, comfortably under the `header-max-length: 100` we keep enforced. So the
group names needn't be shortened; stated with confidence, not hedged.

### 4.5 cooldown — the ecosystem-matrix nuance

`cooldown` (minimum package age) holds a brand-new release for N days before bumping, so a
yanked/compromised version is likely caught first — a supply-chain measure that fits this repo's posture
(secretlint/gitleaks/CSP). We set `default-days: 7` on **both** ecosystems (7d matches the IaC-scanner
norm; e.g. Datadog flags `<7`). The support matrix has one wrinkle: github-actions supports `default-days`
but **not** the `semver-major/minor/patch-days` keys — action versions resolve from git tags, not SemVer
ranges, so per-level cooldown has nothing to act on. npm/Yarn and NuGet support both. We only use
`default-days`, so both blocks are valid.

> **Verification note (a mistake worth recording):** an earlier pass mis-read this as "github-actions
> cooldown unsupported." The options-reference renders the support table with octicon `check`/`x` icons
> that get **stripped** in HTML→markdown conversion, so a fetched/rendered copy returns blank cells —
> easy to read as "not supported." The **raw** source
> (`raw.githubusercontent.com/github/docs/main/…/dependabot-options-reference.md`) is authoritative: the
> github-actions row is `check` / `x` (default-days **yes**, semver-days no). Lesson: read the raw markdown
> for icon-driven tables.

Two corollaries:
- **Security updates ignore cooldown** and arrive **immediately**, individually (they're not batched by
  the version-update `groups` either — that would need `applies-to: security-updates`). That's the
  desired behaviour: security fixes shouldn't wait.
- **Expect a quiet first run.** Cooldown skips any dependency whose latest version published inside the
  7-day window, so the first pass may open fewer PRs than the dependency count suggests. Not a bug.

**The `packageManager` pnpm pin is *outside* this cooldown.** Dependabot doesn't update the
`packageManager` field at all ([dependabot-core#4830](https://github.com/dependabot/dependabot-core/issues/4830)),
so the pnpm version is bumped by hand. Apply the **same 7-day cooldown manually**: pin only a pnpm
release published **≥7 calendar days ago** (`npm view pnpm time --json`). This hand-rule counts
*calendar* days for eyeball-ability — ~0.6 day looser than the *elapsed*-time measurement Dependabot
uses above, an accepted trade-off for a manual check.

> **Lesson (2026-07, worth recording):** the cooldown alone isn't enough — also confirm the target
> **isn't deprecated** (`npm view pnpm@<version> deprecated`). pnpm **11.12.0 and 11.13.0 shipped
> broken and were deprecated by the maintainers within days** (11.12.0 crashes the `pmOnFail:
> download` self-manager, [pnpm#12959](https://github.com/pnpm/pnpm/issues/12959)); a blind "newest
> ≥7-days-old" pick would have landed on the broken 11.12.0. We pinned **11.11.0** instead — aged,
> never deprecated, and the maintainers' recommended fallback for that bug.

### 4.6 Other CI jobs on Dependabot PRs (verified fine)

`verify`/`test` need no secrets; `pnpm install --frozen-lockfile` succeeds because Dependabot updates
`package.json` and `pnpm-lock.yaml` in the same commit. `gitleaks` needs no license on a personal repo.
**pnpm parse risk is low:** `pnpm-lock.yaml` is `lockfileVersion: '9.0'`, single-document, single package
— Dependabot's happy path. (The fragile cases are multi-document lockfiles / workspace globs, neither here.)

## 5. From-scratch recipe (do this on the next project)

1. **Add `.github/dependabot.yml`** with `version: 2` and one `updates` entry per ecosystem. For a pnpm
   app: `package-ecosystem: "npm"`, `directory: "/"`, a weekly `schedule`, `versioning-strategy:
   "increase"`, `commit-message: { prefix, include: "scope" }`, prod/dev `groups` for non-majors, and an
   npm `cooldown`. Add a second entry for `github-actions`. **If you pin a runtime, keep its type stub
   from outrunning it — but the lever is per-runtime.** For Node it's a semver-major `ignore` on
   `@types/node` (whose *major* equals the Node major). A stub versioned by **date** instead — e.g.
   `@cloudflare/workers-types` (`4.YYYYMMDD.x`, tracking `wrangler`'s `compatibility_date`) — couples on
   what Dependabot treats as a *minor*, so a major-ignore won't hold it; pin/ignore its minor or generate
   the types (`wrangler types`) instead. **This repo took the generate route** (see
   [`cd-setup.md`](cd-setup.md)) — trade-off: a Dependabot `wrangler` bump can change the generated file,
   so that PR's CI stays red until you regenerate + commit.
2. **Make commit messages pass your commit linter.** If you enforce Conventional Commits as a *required*
   check, set a lowercase `prefix` (so Dependabot lowercases the verb) **and** relax
   `body-max-line-length`/`footer-max-line-length` (or ignore bot commits). Otherwise Dependabot PRs are
   blocked.
3. **Audit deploy/preview jobs that use secrets.** Any `pull_request` job that needs a secret will fail
   on Dependabot PRs (read-only token, no Actions secrets). Guard it with
   `github.actor != 'dependabot[bot]'`, or add the secret as a Dependabot secret.
4. **Enable Dependabot alerts + security updates** (these are *separate* from version updates above):

   ```bash
   gh api repos/{owner}/{repo}/vulnerability-alerts            # 204 = on, 404 = off
   gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts     # enable alerts
   gh api -X PUT repos/{owner}/{repo}/automated-security-fixes # enable security-update PRs
   ```

   Or **Settings → Advanced Security → Dependabot alerts / Dependabot security updates**.

## 6. First run & validation (what "done" looks like)

- **Config syntax:** `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"`.
  GitHub does the authoritative schema validation on push — config errors surface at **Insights →
  Dependency graph → Dependabot**, *not* in Actions logs (they're otherwise silent).
- **commitlint accepts a Dependabot-style message** (the crux):

  ```bash
  printf 'chore(deps-dev): bump the development-dependencies group across 1 directory with 5 updates\n\nBumps [@testing-library/react](https://github.com/testing-library/react-testing-library) from 16.3.2 to 16.4.0.\n\nSigned-off-by: dependabot[bot] <support@github.com>\n' | pnpm exec commitlint
  ```

  Exit 0. And a malformed human message still fails (`printf 'Bad message' | pnpm exec commitlint` →
  non-zero), proving only length was relaxed.
- **Post-merge (live):** first run opens grouped PRs with `chore(deps)` / `ci(deps)` subjects that pass
  all 4 required checks, and the CD `preview` job shows **skipped** (not failed) on them.

## 7. Operating it

- **Merge promptly.** `main` is Strict (require-up-to-date) + enforce_admins. Dependabot auto-rebases
  open PRs (`rebase-strategy` defaults to `auto`) when `main` moves, so each push re-runs CI on every
  open Dependabot PR. With weekly cadence + a 10-PR cap that's bounded, but stale PRs churn CI.
- **Where to look** when a dependency isn't updating: Insights → Dependency graph → Dependabot (last
  checked / errors). A parse or auth error appears *only* there.
- **Majors** arrive as individual PRs — review the changelog, let CI run, merge one at a time.

## 8. Deferred / future

- **Group security updates / cool them** via `applies-to: security-updates` if the individual+immediate
  default ever gets noisy (it shouldn't for security).
- **Custom labels / assignees** — Dependabot auto-applies a `dependencies` label; add more (must
  pre-exist) or `assignees` if the review flow ever needs it. (`reviewers` is absent from the current
  options reference — use `assignees` / CODEOWNERS instead.)
