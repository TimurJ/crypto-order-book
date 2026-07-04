# Continuous Integration setup — GitHub Actions

A step-by-step record of how the CI pipeline was designed and built, the decisions behind it, the
footguns it sidesteps, and a from-scratch recipe to reproduce it on the next project.

> **Status:** live since **2026-06-27** (commit `cd2ff61`, PR #3). Runs on every pull request and on
> push to `main`; it is the authoritative gate that re-runs the local Husky hooks' checks on the server.
>
> This is the long-form history. The short versions live in
> [`README.md`](../README.md#continuous-integration) (how-to) and
> [`CLAUDE.md`](../CLAUDE.md#ci--github-actions) (rationale). Update those on changes; update this file
> when the *setup itself* changes.
>
> **Scope:** this doc covers the CI workflow as it was first built — the three jobs `verify`, `secrets`,
> `commits`. A fourth job, **`test` (Vitest)**, was added later when the test harness landed; it is
> documented in [`docs/vitest-setup.md`](vitest-setup.md) and only cross-referenced here. A fifth job,
> **`shell` (Shell lint)**, was also added later and — unlike `test` — is documented inline below (§3.1).
> The local
> **Husky hooks** that CI mirrors have their own chronicle — see [`docs/husky-setup.md`](husky-setup.md).

---

## 1. Goals & why these choices

The local Husky hooks (pre-commit, commit-msg, pre-push) already run lint/format, commit-message, and
build/test checks — but they're **bypassable**: `git commit --no-verify`, `git push --no-verify`,
`HUSKY=0`, or a commit made through GitHub's web UI all skip them. CI exists to be the gate that
**can't** be skipped: it re-runs the same checks on the server, on every PR and every push to `main`,
so nothing broken lands even when a hook was bypassed.

- **Hooks = fast local feedback; CI = the authoritative backstop.** They deliberately overlap. The
  hooks catch problems in seconds before you push; CI is the source of truth that branch protection
  enforces before a merge.
- **GitHub Actions**, because the repo is already on GitHub — no extra service, native PR checks, free
  for this account. The same workflow file is the unit of version control and review.
- **One clean check per concern.** Each job surfaces as its own PR status check, which makes each a
  precise, independently-required branch-protection target (see §7).

---

## 2. Architecture decisions (the locked forks)

| Decision | Choice | Why |
|---|---|---|
| Biome in CI | **`pnpm biome ci`** (the pinned devDep), not `biomejs/setup-biome` | Biome is pinned exact (2.5.1); using the project's own copy makes CI and local lint identical. `setup-biome@version: latest` would drift from the lockfile. (Same reasoning CD uses for `pnpm exec wrangler`.) See [`biome-setup.md`](biome-setup.md). |
| Version sources | **Node via `.nvmrc`**, **pnpm via `packageManager`** | Single source of truth: setup-node reads `node-version-file: .nvmrc`; `pnpm/action-setup` reads the `packageManager` field. The workflow hardcodes **no** tool versions. `.nvmrc` *selects* the Node 24.x; an `engines.node: ">=24 <25"` gate (+ `engineStrict: true` in `pnpm-workspace.yaml`) *enforces* it — `pnpm install` fails on any other major, in CI and locally. |
| Step order | **`pnpm/action-setup` *before* `actions/setup-node`** | setup-node's `cache: pnpm` needs the pnpm binary on PATH to resolve the store path. Reverse the order and caching fails. |
| Job granularity | **One job per concern** (`verify` · `secrets` · `commits`) | Distinct PR checks = clean, independently-required branch-protection targets. Cost: a second `pnpm install` per extra install-needing job (accepted). |
| Permissions | **Least privilege** — `contents: read` default | `commits` widens to add `pull-requests: read`; nothing gets write. |
| Run hygiene | **`concurrency` group + `cancel-in-progress`** | Superseded runs on the same PR/branch are cancelled, saving minutes. Actions pinned to **major tags** (verified live). |

These were settled before the workflow was written and verified against the live action registry on
2026-06-27 (see §3.2).

---

## 3. What was built, file by file

Commit `cd2ff61` added three files (and one line to a fourth):

- **`.github/workflows/ci.yml`** — the workflow. `on: push` (branches `[main]`) **+** `pull_request`;
  top-level `permissions: contents: read`; a `concurrency` group keyed on
  `github.head_ref || github.run_id` with `cancel-in-progress: true`; then the jobs (§3.1).
- **`.nvmrc`** — `24`. Selects *which* Node 24.x runs (consumed by CI's `node-version-file` and by
  `nvm use` locally). It's advisory, so it's paired with an enforced gate: **`engines.node: ">=24 <25"`**
  in `package.json` + **`engineStrict: true`** in `pnpm-workspace.yaml` fail `pnpm install` on any other
  Node major. **Gotcha (verified empirically):** on pnpm 11 `engines` *alone* only warns (the docs'
  "always fails" is wrong for this version); `engineStrict` is the switch, and it must live in
  `pnpm-workspace.yaml` — pnpm 11 reads only auth/registry from `.npmrc`, so `engine-strict` there is a no-op.
- **`package.json`** — added `"packageManager": "pnpm@11.9.0"`, the single source for the pnpm version
  (auto-detected by `pnpm/action-setup`, so the workflow names no pnpm version).

It **relies on** config that already existed:

- **`biome.json`** — the lint/format rules `pnpm biome ci` enforces.
- the **`commitlint`** block in `package.json` (extends `@commitlint/config-conventional`; added by the
  earlier hooks commit `46c0783`) — read by the `commits` job's commitlint action.
- **No `.gitleaks*` config file** — the secret scan runs on the action's default ruleset.

### 3.1 The CI jobs (`ci.yml`)

| Job | Name (PR check) | Trigger | What it does |
|---|---|---|---|
| `verify` | **Lint, typecheck & build** | PR + push to `main` | `pnpm install --frozen-lockfile` → `pnpm biome ci` (read-only lint + format, emits GitHub annotations) → `pnpm build` (`tsc -b && vite build`). Mirrors the pre-commit Biome hook + the pre-push build. |
| `secrets` | **Secret scan (gitleaks)** | PR + push to `main` | checkout with `fetch-depth: 0` (full history) → `gitleaks/gitleaks-action@v3` with `GITHUB_TOKEN`. A deep backstop to the staged-file secretlint hook. |
| `commits` | **Commit messages (commitlint)** | **PR only** (`if: github.event_name == 'pull_request'`) | checkout `fetch-depth: 0` → `wagoid/commitlint-github-action@v6`, using the `commitlint` config in `package.json`. Adds `pull-requests: read`. Backstop to the local `commit-msg` hook. |
| `test` | **Test (Vitest)** | PR + push to `main` | *Added later with the test harness — see [`docs/vitest-setup.md`](vitest-setup.md). Same setup block as `verify`, runs `pnpm test:run`.* |
| `shell` | **Shell lint (shellcheck)** | PR + push to `main` | *Added later.* Checkout-only (no pnpm/node) → `bash -n` + `shellcheck` on `scripts/*.sh`, and `shellcheck --shell=sh` on the Husky hooks. Guards the release script's portability (GNU ↔ BSD) and syntax — nothing else lints shell (Biome is ts/tsx-only). |

`verify` and `test` are the only jobs that install dependencies; `secrets`, `commits`, and `shell`
need only a checkout. Only `commits` is PR-gated (on a push to `main` there is no PR commit range to lint — see §4).

Shell-job specifics worth remembering: `shellcheck` **and** `bash` are preinstalled on
`ubuntu-latest`, so the job needs no marketplace action or `apt-get` (nothing to pin — the sole
`uses:` is `actions/checkout`). Two footguns it sidesteps: `bash -n` only syntax-checks its **first**
argument (the rest become positional params), so the syntax step **loops** over `scripts/*.sh` rather
than passing the glob directly; and the Husky hooks are shebang-less and run under `/bin/sh` (dash on
Linux), so they're linted with `--shell=sh`, not as bash. Those hooks are discovered with
`git ls-files '.husky/*'` (not a glob) so a newly added hook can't slip past unlinted — and it skips
the gitignored `.husky/_/` stubs that a plain glob would wrongly hand to shellcheck.

### 3.2 Action versions (verified live 2026-06-27)

| Action | Pin | Role |
|---|---|---|
| `actions/checkout` | `@v7` | Clone the repo (`fetch-depth: 0` where full history is needed) |
| `pnpm/action-setup` | `@v6` | Install pnpm from the `packageManager` field — **runs first** |
| `actions/setup-node` | `@v6` | Install Node from `.nvmrc`; `cache: pnpm` |
| `gitleaks/gitleaks-action` | `@v3` | Full-history secret scan |
| `wagoid/commitlint-github-action` | `@v6` | Conventional-Commits check on PR commits |

Pinned to **major tags** so patch/minor fixes flow in without churn; re-verify against the live
marketplace before reusing on a new project (don't trust a stale blog).

---

## 4. Gotchas & footguns (and how this setup avoids them)

Unlike the CD and Vitest setups, CI came up clean — there was no dramatic bug to chase. These are the
footguns a naïve workflow hits, and how this one sidesteps each (symptom → cause → fix). This is the
high-value section for "next time."

1. **Step order — pnpm before Node.**
   *Symptom:* setup-node fails with `Unable to locate executable file: pnpm`.
   *Cause:* `actions/setup-node` with `cache: pnpm` runs `pnpm store path` to find the cache dir, but
   pnpm isn't installed yet.
   *Fix:* put `pnpm/action-setup` **before** `actions/setup-node` in every job that caches.

2. **gitleaks needs full history.**
   *Symptom:* secrets buried in older commits slip past the scan.
   *Cause:* the default checkout is shallow (`fetch-depth: 1`), so gitleaks only sees the tip.
   *Fix:* `actions/checkout` with `fetch-depth: 0` in the `secrets` job.

3. **gitleaks licensing under a GitHub org.**
   *Symptom:* the action errors demanding a license.
   *Cause:* `gitleaks-action` is **free for personal accounts**, but a repo under a GitHub **org**
   requires a (free) `GITLEAKS_LICENSE`.
   *Fix:* this repo is personal, so nothing is needed. If it ever moves under an org, obtain the free
   license key and add it as the `GITLEAKS_LICENSE` secret.

4. **commitlint is PR-only and needs the commit range.**
   *Symptom:* on a push to `main`, a commit-range lint has nothing to compare against; or it lints zero
   commits.
   *Cause:* commitlint validates the *range* of commits a PR introduces, which only exists in the PR
   event; and the range needs history.
   *Fix:* gate the job with `if: github.event_name == 'pull_request'` and check out `fetch-depth: 0`.
   (The local `commit-msg` hook covers commits at authoring time; this is the server backstop.)

5. **Biome version drift.**
   *Symptom:* CI flags (or misses) lint findings that local `pnpm check` doesn't.
   *Cause:* `biomejs/setup-biome` with `version: latest` installs a different Biome than the
   exact-pinned `2.5.1` devDep.
   *Fix:* run `pnpm biome ci` — the lockfile's copy — so CI and local are byte-identical.

6. **Lockfile drift must be a hard failure.**
   *Symptom:* CI silently resolves a different dependency tree than the committed lockfile.
   *Cause:* a plain `pnpm install` will mutate/relax the lockfile.
   *Fix:* `pnpm install --frozen-lockfile` — CI fails if `pnpm-lock.yaml` is out of sync, forcing the
   lockfile to be committed.

---

## 5. From-scratch setup recipe (do this on the next project)

Assumes a pnpm project on GitHub with Biome and (optionally) commitlint already configured. Adjust
action versions to whatever the live marketplace shows.

1. **Pin the toolchain once:** create `.nvmrc` (e.g. `24`) and set
   `"packageManager": "pnpm@<x.y.z>"` in `package.json`. The workflow will read both — never hardcode
   versions in the YAML. To *enforce* the Node major (not just advise it), add
   `"engines": { "node": ">=24 <25" }` to `package.json` **and** `engineStrict: true` to
   `pnpm-workspace.yaml` (on pnpm 11 `engines` alone only warns; `.npmrc` `engine-strict` is a no-op).
2. **Create `.github/workflows/ci.yml`** with the shell:
   ```yaml
   name: CI
   on:
     push:
       branches: [main]
     pull_request:
   permissions:
     contents: read
   concurrency:
     group: ${{ github.workflow }}-${{ github.head_ref || github.run_id }}
     cancel-in-progress: true
   ```
3. **`verify` job** — the install-and-build path. **pnpm before node:**
   ```yaml
   - uses: actions/checkout@v7
   - uses: pnpm/action-setup@v6        # reads packageManager
   - uses: actions/setup-node@v6
     with:
       node-version-file: .nvmrc
       cache: pnpm
   - run: pnpm install --frozen-lockfile
   - run: pnpm biome ci                 # read-only lint + format
   - run: pnpm build                    # tsc -b && vite build
   ```
4. **`secrets` job** — `actions/checkout@v7` with `fetch-depth: 0`, then
   `gitleaks/gitleaks-action@v3` with `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Under a GitHub
   org, also add a `GITLEAKS_LICENSE` secret.
5. **`commits` job** — `if: github.event_name == 'pull_request'`, `permissions: { contents: read,
   pull-requests: read }`, checkout `fetch-depth: 0`, then `wagoid/commitlint-github-action@v6`.
6. **If the project has tests**, add a `test` job mirroring `verify`'s setup block and running your
   one-shot test command (here `pnpm test:run`) — see [`docs/vitest-setup.md`](vitest-setup.md).
7. **Verify every action's version** against the live marketplace before pinning (major tags).
8. **Open a PR.** Once each job has run there at least once, add the checks to `main`'s required
   branch-protection set (§7).

---

## 6. First run & validation (what "done" looked like)

- Each job appears as a **distinct check** on the PR: *Lint, typecheck & build*, *Secret scan
  (gitleaks)*, *Commit messages (commitlint)* (and, after the harness landed, *Test (Vitest)*).
- On a push to `main`, the `commits` check correctly **does not run** (PR-only); the rest do.
- The proof of value is the mirror: a PR pushed with `--no-verify` (skipping the local hooks) is still
  caught server-side by the same lint/build/secret/commit checks.
- A later PR (#6) showed all four checks green end-to-end, confirming the workflow under real load.

---

## 7. Operating it

- **When it runs:** every pull request and every push to `main`. The `concurrency` group cancels a
  superseded run when you push again to the same PR/branch.
- **Bumping versions:** change `.nvmrc` (Node) or the `packageManager` field (pnpm) — **not** the
  workflow. CI picks them up automatically. **Bumping the Node major means changing `.nvmrc` *and*
  `engines.node`** (the enforced gate) together — CI's `pnpm install` cross-checks them, so a mismatch
  fails loudly. Bump Biome by changing the pinned devDep; CI uses that copy.
- **Branch protection:** `main` is **Strict**-protected — PRs only, the required CI checks must pass
  with the branch up to date, enforced on admins too. When a new check (like *Test (Vitest)*) first
  runs on a PR, add it to the required set. The **CD** checks are intentionally *not* required (they
  skip on PRs or depend on Cloudflare).
- **Local equivalent:** the Husky hooks run the same checks faster, before you push. CI is the
  non-bypassable copy.

---

## 8. Deferred / future

- **`test` job — DONE.** Landed with the Vitest harness; see [`docs/vitest-setup.md`](vitest-setup.md).
- **Dependency automation** (Dependabot) + **SAST** (CodeQL) — fits the existing security posture;
  tracked in [`production-readiness.md`](production-readiness.md) Tier 2.
- **Node-version matrix** — single Node (`.nvmrc`, enforced via `engines`) for now; a matrix would only
  matter once the app must support multiple runtimes (which would mean widening/removing the `engines` gate).
- **Caching beyond the pnpm store** — `tsc -b` build-info / Vite cache could be cached if CI time
  grows; unnecessary at this scale.
- **Coverage upload** in CI — deferred with coverage thresholds; see `docs/vitest-setup.md` §8.
