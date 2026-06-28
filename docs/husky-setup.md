# Git hooks setup — Husky + lint-staged

A step-by-step record of how the local git-hook quality gate was built, the decisions behind it, the
gotchas hit along the way, and a from-scratch recipe to reproduce it on the next project.

> **Status:** live since **2026-06-27** (commit `46c0783`, PR #2, branch `chore/add-husky`). Three
> hooks — `pre-commit`, `commit-msg`, `pre-push` — self-install on `pnpm install`.
>
> This is the long-form history. The short versions live in
> [`README.md`](../README.md#git-hooks) (how-to) and [`CLAUDE.md`](../CLAUDE.md#git-hooks--husky)
> (rationale). Update those on changes; update this file when the *setup itself* changes.
>
> **Scope:** the hooks subsystem as first built — `pre-commit` (lint-staged), `commit-msg`
> (commitlint), `pre-push` (`pnpm build`). The pre-push **`pnpm test:run`** step was added later with
> the test harness; it's documented in [`docs/vitest-setup.md`](vitest-setup.md) and only
> cross-referenced here.

---

## 1. Goals & why these choices

The point is a **fast, local quality gate** that catches problems before code ever leaves the machine —
so the feedback loop is seconds, not a CI round-trip. The hooks are layered by cost:

- **`pre-commit`** — lint/format and secret-scan only the **staged** files (sub-second).
- **`commit-msg`** — enforce Conventional Commits on the message (instant).
- **`pre-push`** — run the **whole-project** build (and, later, the test suite) — the expensive check,
  deferred to the rarer push event.

These hooks are the *first* line of defence, not the authoritative one. They're bypassable
(`--no-verify`, `HUSKY=0`, a Git GUI that skips them), so **CI re-runs every one of these checks on the
server** — see [`docs/ci-setup.md`](ci-setup.md). The hooks make the common case fast; CI makes it
enforceable.

Tool choices:

- **Husky 9** — the de-facto standard hook manager; self-installs via a `prepare` script, so a fresh
  `pnpm install` wires the hooks with no extra step.
- **lint-staged** — runs tasks against *only the staged files*, so pre-commit stays fast and never
  reformats unrelated code.
- **secretlint** — a staged-file secret scanner, the local complement to CI's full-history gitleaks.
- **commitlint** (+ `config-conventional`) — enforces the Conventional Commits format the changelog/
  release tooling depends on.

---

## 2. Architecture decisions (the locked forks)

| Decision | Choice | Why |
|---|---|---|
| Hook manager | **Husky 9**, self-installing via **`"prepare": "husky"`** | A fresh `pnpm install` generates `.husky/_/` and points `core.hooksPath` at it — no manual `git config` per clone |
| Layering | **lint-staged at `pre-commit`; full `pnpm build` (+ later `test:run`) at `pre-push`** | Cheap, frequent checks at commit; the expensive whole-project check at the rarer push |
| pre-commit scope | **biome on `*.{ts,tsx}`** + **secretlint on `*`** | The biome glob mirrors `biome.json` `files.includes` (ts/tsx only — see [`biome-setup.md`](biome-setup.md)); secretlint scans **every** staged file (configs, env, lockfiles…) |
| Blocking threshold | **Only errors block** at commit | `biome check` exits 0 on warnings (matches `pnpm check`); warnings are left to `pnpm build` / CI, so commits aren't blocked on noise |
| Commit messages | **commitlint + `config-conventional`** | Config block lives in `package.json`; the **same** config backs the CI `commits` job (see [`ci-setup.md`](ci-setup.md)) |
| Secret scanning | **secretlint preset-recommend**, `--no-glob` | Local staged-file scan; CI's gitleaks is the full-history backstop |
| Escape hatches | **`HUSKY=0`** (skip install) / **`--no-verify`** (skip one run) | For Docker/CI and the occasional intentional bypass — CI re-runs everything regardless |

---

## 3. What was built, file by file

Everything below landed in commit `46c0783` (the Biome migration did **not** include husky/lint-staged):

- **`package.json`**
  - added the **`"prepare": "husky"`** script (runs on every `pnpm install`).
  - added the **`lint-staged`** block:
    ```json
    "lint-staged": {
      "*.{ts,tsx}": "biome check --write --no-errors-on-unmatched",
      "*": "secretlint --no-glob"
    }
    ```
  - added the **`commitlint`** block: `{ "extends": ["@commitlint/config-conventional"] }`.
  - added the six devDeps (§3.1).
- **`.husky/pre-commit`** → `pnpm exec lint-staged`
- **`.husky/commit-msg`** → `pnpm exec commitlint --edit "$1"` (`$1` = the path to the commit-message
  file git passes the hook)
- **`.husky/pre-push`** → `pnpm build` (originally followed by a `# TODO: add pnpm test` comment; the
  **`pnpm test:run`** line was added later with Vitest — see [`docs/vitest-setup.md`](vitest-setup.md))
- **`.secretlintrc.json`** → `{ "rules": [{ "id": "@secretlint/secretlint-rule-preset-recommend" }] }`
- **`.gitignore`** → the **Env/secrets** block (`.env`, `.env.*`, `!.env.example`) — secrets hygiene
  that pairs with the secretlint hook
- **`.husky/_/`** → **generated** by `prepare: husky`, **not** committed (gitignored via its own
  `.husky/_/.gitignore` containing `*`). This is where husky writes the wrapper scripts and points
  `core.hooksPath`. The three tracked hook files (`.husky/pre-commit` etc.) are the ones you edit.

> **Husky v9 hook format:** hook files are now **plain command files** — just the command, no shebang
> and no `. "$(dirname -- "$0")/_/husky.sh"` sourcing boilerplate (that was v8). The wrapper lives in
> the generated `.husky/_/`.

### 3.1 Dependencies & versions

| Package | Range | Role |
|---|---|---|
| `husky` | `^9.1.7` | Hook manager / installer |
| `lint-staged` | `^17.0.8` | Run tasks on staged files (pre-commit) |
| `secretlint` | `^13.0.2` | Secret scanner CLI |
| `@secretlint/secretlint-rule-preset-recommend` | `^13.0.2` | secretlint's recommended ruleset (`.secretlintrc.json`) |
| `@commitlint/cli` | `^21.1.0` | Commit-message linter (commit-msg) |
| `@commitlint/config-conventional` | `^21.1.0` | Conventional Commits ruleset |

> **Pinning contrast:** these are **caret-pinned**, whereas Biome (`2.5.1`) and the Vitest engines are
> **exact-pinned**. The rule of thumb: pin the tools whose *output* must be deterministic across
> machines (a lint/format engine, a test runner) exactly; let the rest float on caret, since the
> committed `pnpm-lock.yaml` governs the actual installed versions anyway.

---

## 4. Gotchas hit & footguns (and how they're handled)

Each is symptom → cause → fix. The first was genuinely hit during setup; the rest are footguns the
configuration sidesteps.

1. **The husky `--version` footgun — genuinely hit.**
   *Symptom:* after a stray `pnpm exec husky --version`, **every** hook fails on commit/push with
   `sh: 0: Illegal option --`, and the real tools (lint-staged/commitlint/secretlint) never run.
   *Cause:* husky v9's CLI takes a **directory argument** (`husky [dir]`, default `.husky`) and has
   **no `--version` flag**. So `husky --version` installs husky into a `--version/` directory and sets
   `core.hooksPath=--version/_`; git then invokes wrapper paths starting with `--`, which `/bin/sh`
   (dash) rejects as options.
   *Fix:* **never run `husky --version`.** Check the version by reading `package.json` devDeps or
   `node_modules/husky/package.json`. If already corrupted, repair with
   `git config core.hooksPath .husky/_` and `rm -rf -- ./--version`.

2. **Git GUI / IDE commits fail where the terminal succeeds.**
   *Cause:* a GUI (Sourcetree, the VS Code Git panel, JetBrains) doesn't load your shell's Node version
   manager (nvm/fnm), so `pnpm`/`node` aren't on PATH when the hook runs.
   *Fix:* put the version-manager init in **`~/.config/husky/init.sh`** — husky sources it before
   running hooks.

3. **lint-staged stashes, runs, re-stages, restores.**
   *Cause:* to avoid linting unstaged changes, lint-staged stashes your unstaged work, runs the tasks
   against the **staged** content, **re-stages** biome's safe fixes, then restores the stash.
   *Effect to know:* this is why partially-staged files behave predictably and why biome's auto-fixes
   end up in the commit. Not a bug — just non-obvious.

4. **`biome check --no-errors-on-unmatched`.**
   *Cause:* if a commit stages only non-ts/tsx files, biome receives an empty file list (after
   lint-staged's filter) and would exit non-zero with "no files matched", blocking the commit.
   *Fix:* the `--no-errors-on-unmatched` flag makes that case a no-op success.

5. **`secretlint --no-glob`.**
   *Cause:* lint-staged passes **literal file paths** as arguments. Without `--no-glob`, secretlint
   would interpret them as glob *patterns*.
   *Fix:* `--no-glob` tells secretlint to treat each argument as a concrete path.

6. **Hooks don't exist until `pnpm install` runs.**
   *Cause:* `.husky/_/` and the `core.hooksPath` setting are **generated** by the `prepare: husky`
   script, not committed. A fresh clone has the tracked hook files but no active hooks until install.
   *Fix:* nothing to do — `pnpm install` wires them. Set `HUSKY=0` to deliberately skip install
   (Docker images, CI).

---

## 5. From-scratch setup recipe (do this on the next project)

Assumes a pnpm project with Biome already configured. Adjust versions to whatever the registry shows.

1. **Install the tooling:**
   ```bash
   pnpm add -D husky lint-staged secretlint @secretlint/secretlint-rule-preset-recommend \
              @commitlint/cli @commitlint/config-conventional
   ```
2. **Initialise husky:** `pnpm exec husky init` — it creates `.husky/`, adds a sample `pre-commit`, and
   adds `"prepare": "husky"` to `package.json`. (Or add the `prepare` script yourself and run
   `pnpm install`.)
3. **Write the three hook files** (plain command files — no boilerplate in v9):
   ```sh
   # .husky/pre-commit
   pnpm exec lint-staged
   # .husky/commit-msg
   pnpm exec commitlint --edit "$1"
   # .husky/pre-push
   pnpm build
   pnpm test:run   # add once tests exist — see docs/vitest-setup.md
   ```
4. **Configure the tasks** in `package.json`:
   ```json
   "lint-staged": {
     "*.{ts,tsx}": "biome check --write --no-errors-on-unmatched",
     "*": "secretlint --no-glob"
   },
   "commitlint": { "extends": ["@commitlint/config-conventional"] }
   ```
5. **`.secretlintrc.json`:** `{ "rules": [{ "id": "@secretlint/secretlint-rule-preset-recommend" }] }`.
6. **Gitignore secrets:** add `.env`, `.env.*`, `!.env.example` (pairs with the secretlint hook).
7. **Test it:** make a commit (watch lint-staged + secretlint run), try a bad commit message (it should
   be rejected), then `git push` (the build runs). **Never run `husky --version`** (§4.1).
8. **For GUI commits**, add `~/.config/husky/init.sh` with your version-manager init.

---

## 6. First run & validation (what "done" looked like)

- A Conventional-Commits message (e.g. `chore(hooks): …`) passes `commit-msg`; a non-conforming
  message (`added stuff`) is **rejected**.
- Staged `.ts`/`.tsx` files are auto-formatted by biome and **re-staged** into the same commit.
- secretlint runs over every staged file; a planted dummy credential is **blocked**.
- `git push` runs `pnpm build` (and, after the harness landed, `pnpm test:run`), catching type/bundle
  breakage locally before it reaches CI.
- During setup the husky `--version` footgun (§4.1) was hit and repaired — the lesson that became the
  "never run it" rule.

---

## 7. Operating it

- **When each fires:** `pre-commit` on `git commit` (lint-staged → biome + secretlint), `commit-msg`
  on the message, `pre-push` on `git push` (`pnpm build` + `pnpm test:run`).
- **Bypass:** `git commit --no-verify` / `git push --no-verify` skip a single run; `HUSKY=0` skips hook
  *installation* (Docker/CI). CI re-runs all of it regardless — see [`docs/ci-setup.md`](ci-setup.md).
- **GUI commits:** if a Git GUI can't find `pnpm`/`node`, add `~/.config/husky/init.sh` (§4.2).
- **Don't run `husky --version`** — read the version from `package.json`/`node_modules` (§4.1).
- **Editing hooks:** change the tracked `.husky/<hook>` files; never touch the generated `.husky/_/`.

---

## 8. Deferred / future

- **pre-push `pnpm test:run` — DONE.** Added with the Vitest harness; see
  [`docs/vitest-setup.md`](vitest-setup.md).
- **More lint-staged tasks** if the toolchain grows (e.g. a CSS linter, markdown lint) — the `*` and
  per-extension globs make it easy.
- **secretlint in CI is unnecessary** — CI already runs gitleaks over the full history as the deep
  backstop (see [`docs/ci-setup.md`](ci-setup.md)); the secretlint hook covers the staged-file case
  locally.
