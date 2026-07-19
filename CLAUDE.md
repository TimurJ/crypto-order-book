# CLAUDE.md

Guidance for working in this repository.

## Overview

`crypto-order-book` — a React 19 + TypeScript single-page app built with Vite 8, Tailwind
CSS v4, and shadcn/ui (the `base-mira` style, which uses **Base UI** primitives — not Radix —
and Tabler icons). Package manager is **pnpm**.

> Status: **order book live end-to-end**. The app (`src/App.tsx`) renders the live BTCUSDT
> order book (every env, prod included). Four domain subsystems have landed: the
> **WebSocket transport** (`src/lib/connection/`, part 1 of the connection stack), the
> **server-state / REST layer** (**TanStack Query v5**, `src/lib/query/`, with the Worker's
> first `/api/*` route, `/api/health`, as its demo consumer), the **Binance order-book sync
> layer** (`src/lib/order-book/`, part 2 — a live, self-healing local book), and the
> **order-book UI** (`src/features/order-book/`, part 3 — a manually rendered slot-keyed
> ladder; the connection stack is complete). The CI **and** CD pipelines are **live** — three-env
> Cloudflare Workers deploy (DEV/UAT/PROD), build-once-promote verified. `main` is
> branch-protected.
>
> This repo doubles as the **reference foundation** for future standalone projects: every major
> subsystem gets a `docs/<name>-{setup,architecture}.md` chronicle (decisions, gotchas, reuse
> recipe), so a new project can point here and replay the setup instead of reinventing it.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | `tsc -b && vite build` (type-checks via project refs, then bundles) |
| `pnpm preview` | Serve the production build |
| `pnpm test` | `vitest` (watch mode) |
| `pnpm test:run` | `vitest run` (one-shot; used by CI + pre-push) |
| `pnpm test:ui` | `vitest --ui` (browser test dashboard) |
| `pnpm test:coverage` | `vitest run --coverage` (v8 coverage) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome lint` (read-only) |
| `pnpm format` | `biome format --write` |
| `pnpm check` | `biome check --write` (lint + format, applies safe fixes) |
| `pnpm release <patch\|minor\|major> [rc]` | `scripts/release-tag.sh` — compute the next tag off the latest release, preflight, then tag + push (drives CD). `rc` → UAT candidate; `--dry-run`/`--yes` supported |
| `pnpm deploy:dev` / `:uat` / `:prod` | `wrangler deploy --env <name>` to a Cloudflare Workers env |
| `pnpm cf-typegen` | `wrangler types …` — regenerate the committed `worker/worker-configuration.d.ts` (runtime types from `compatibility_date`) |
| `pnpm cf-typegen:check` | `wrangler types … --check` — fail if that file is stale vs `wrangler.jsonc` (CI gate) |

## Linting & formatting — Biome

A single tool, **Biome 2.5.1** (pinned exact in `package.json`), handles both linting and
formatting. It replaced ESLint + Prettier. Config lives in `biome.json`.

- **Scoped to `.ts`/`.tsx` only.** Biome deliberately does **not** touch CSS or JSON. Do not
  add CSS to its scope: Biome has open upstream bugs parsing Tailwind v4 at-rules
  (`@theme`, `@custom-variant`, `@plugin`), and Vite/Tailwind already own `src/index.css`.
  The everything-else editor defaults (charset, LF, final newline, 2-space indent) live in
  **`.editorconfig`**, which mirrors this formatter so CSS/JSON/MD/YAML stay consistent.
- **Formatter:** 2-space indent, double quotes, no semicolons, `es5` trailing commas, 80-col
  width, LF. (Matches the project's previous Prettier config byte-for-byte.)
- **Linter:** `recommended` preset + the `react` domain. `useComponentExportOnlyModules` is
  kept **strict (`error`)**. `src/components/ui/**` is exempted from it via `overrides`
  (vendored shadcn primitives co-locate `cva` variants with components by design).
- Import organizing is **off** (`assist` disabled). There is **no Tailwind class sorting**
  (dropped with `prettier-plugin-tailwindcss`; Biome has no equivalent).
- **Convention: fix lint findings in code. Do not add `biome-ignore` / `eslint-disable`**
  unless genuinely unavoidable — exhaust refactors first.

**Full setup, gotchas, and a from-scratch recipe:** [`docs/biome-setup.md`](docs/biome-setup.md) (keep
it updated when the setup itself changes).

## Testing — Vitest

Tests run on **Vitest 4** (pinned exact, like Biome) with **React Testing Library** + **jsdom**.
Config is `vitest.config.ts`; tests live beside the code they cover as `*.test.ts(x)`.

- **`vitest.config.ts`** `mergeConfig`s the app's `vite.config.ts`, so tests inherit the `@`→`src`
  alias and the `react()`/`tailwindcss()` plugins (the `runtimeConfig` plugin is inert under test).
  Settings: `environment: "jsdom"`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]` (the setup
  file registers jest-dom matchers via `@testing-library/jest-dom/vitest` and stubs `window.matchMedia`,
  which jsdom omits — needed by `ThemeProvider`'s `system`-theme path).
- **`globals: true`** gives both import-free `describe`/`it`/`expect` and the global `afterEach` RTL
  needs for automatic DOM cleanup.
- **Type isolation:** a dedicated **`tsconfig.test.json`** (4th project reference, like the Worker's)
  confines `vitest/globals` + jest-dom types to tests (plus `vite/client`, so app modules a test
  imports can still use `import.meta.env`); test files are excluded from `tsconfig.app.json`. It's in the root `references`, so **`tsc -b` (`pnpm build`) type-checks tests
  too** (deliberate). **Gotcha:** tsconfig globs support only `* ? **` — **no `{a,b}` brace
  expansion** — so the test patterns are enumerated.
- **No mocking for `<App />`:** `getConfig()` falls back to `{ env: "local", … }` when
  `window.__APP_CONFIG__` is unset; assert via roles/text (RTL), not implementation details.
- **Query harness:** any component touching `useQuery` renders via `renderWithClient`
  (`src/test/render-with-client.tsx`) — a fresh per-test client from the real factory with
  `retry: false` + `gcTime: Infinity` (`src/test/query-client.ts`); seed the cache
  (`client.setQueryData`) before mount for fetch-free determinism (how `App.test.tsx` works).
  Recipe + mocking layers: [`docs/tanstack-query-setup.md`](docs/tanstack-query-setup.md).

**Full setup, gotchas, and a from-scratch recipe:** [`docs/vitest-setup.md`](docs/vitest-setup.md)
(keep it updated when the setup itself changes).

## Git hooks — Husky

Three local git hooks, managed by **Husky 9** (self-installing via `"prepare": "husky"`, which
runs on every `pnpm install`). Husky sets `core.hooksPath` to `.husky/_/` (auto-generated,
gitignored via its own `.husky/_/.gitignore`); the tracked hook files are `.husky/pre-commit`,
`.husky/commit-msg`, and `.husky/pre-push`. The layering is deliberate — fast checks at commit,
the whole-project build at push:

- **`pre-commit` → `pnpm exec lint-staged`.** The `lint-staged` block in `package.json` runs two
  tasks on staged files: `biome check --write --no-errors-on-unmatched` on `*.{ts,tsx}` (lint +
  format, **re-staging** safe fixes), and `secretlint --no-glob` on `*` (every staged file — see
  Secrets). lint-staged stashes unstaged work, runs the tasks, then restores. The Biome glob
  mirrors `files.includes` (ts/tsx only). **Only errors block** — `biome check` exits 0 on
  warnings (e.g. unused vars), matching `pnpm check`; those are left to `pnpm build`/CI.
- **`commit-msg` → `pnpm exec commitlint --edit "$1"`.** Enforces **Conventional Commits**
  (`@commitlint/config-conventional`; config is the `commitlint` block in `package.json`). Subjects
  must be `type(scope): summary` — `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, etc.
- **`pre-push` → `pnpm build` then `pnpm test:run`.** Runs the *real* build (`tsc -b && vite build`)
  and the test suite (`vitest run`) before a push, so type/bundle/test breakage is caught locally
  rather than in CI.
- **Skipping:** `HUSKY=0` skips hook install (Docker/CI); `git commit --no-verify` /
  `git push --no-verify` bypass for a single run. For GUI/IDE commits that don't load your Node
  version manager, put its init in `~/.config/husky/init.sh`.

**Full setup, gotchas, and a from-scratch recipe:** [`docs/husky-setup.md`](docs/husky-setup.md) (keep
it updated when the setup itself changes).

## CI — GitHub Actions

CI lives in `.github/workflows/ci.yml` and runs on **pull requests** and **pushes to `main`**. It is
the *authoritative* gate — it re-runs the local hooks' checks on the server, so bypassed/skipped hooks
(`--no-verify`, `HUSKY=0`, commits made via GitHub's web UI) can't land broken state. Six parallel
jobs, each a distinct PR check (clean targets for branch protection):

- **`verify`** — `pnpm install --frozen-lockfile`, then `pnpm biome ci` (read-only lint + format,
  emits GitHub annotations) and `pnpm build` (`tsc -b && vite build` — typecheck + bundle). Mirrors
  the pre-commit Biome and pre-push build hooks.
- **`test`** — `pnpm install --frozen-lockfile`, then `pnpm test:run` (`vitest run`). Mirrors the
  pre-push test step; same setup block as `verify`.
- **`secrets`** — `gitleaks/gitleaks-action@v3` with `fetch-depth: 0` (full-history scan), a deep
  backstop to the staged-file secretlint hook. Free for personal accounts; under a GitHub **org** it
  needs a free `GITLEAKS_LICENSE` secret.
- **`commits`** — `wagoid/commitlint-github-action@v6`, PR-only; reads the same `commitlint` config
  from `package.json`. Backstop to the local `commit-msg` hook (catches `--no-verify` / web-UI commits).
- **`shell`** — `shellcheck` + `bash -n` on `scripts/*.sh`, plus `shellcheck --shell=sh` on the Husky
  hooks. Guards the PROD-cutting release helper's cross-platform portability (GNU on WSL ↔ BSD on
  macOS) and syntax — nothing else lints shell (Biome is ts/tsx-only).
- **`dependency-review`** — `actions/dependency-review-action@v5`, PR-only; fails a PR that introduces
  a dependency with a **moderate**-or-higher known advisory (reads GitHub's dependency-review API — the
  dependency graph is on for this public repo). Checkout-only, inherits `contents: read` (findings in
  the job summary, no PR comment). Vulnerability-gating only — `license-check` no-ops without an
  allow/deny list.

Design decisions:

- **Biome runs via the pinned devDependency (`pnpm biome ci`), not `biomejs/setup-biome`.** Biome is
  pinned exact (2.5.1); using the project's own copy guarantees CI and local lint identically — the
  setup-biome action with `version: latest` would risk drift.
- **Single source of truth for versions.** Node via `.nvmrc` (`24`), consumed by setup-node's
  `node-version-file` and by `nvm use`; pnpm via `package.json`'s `packageManager` field
  (`pnpm@11.11.0`), auto-detected by `pnpm/action-setup@v6` so the workflow hardcodes no pnpm version.
  `.nvmrc` *selects* which Node 24.x runs; a separate **`engines`/`engineStrict` gate enforces** it
  (`pnpm install` fails on any other major, so local/CI can't drift onto Node 22/26) — full mechanism
  and the pnpm-11 gotcha in the Node-lock entry under Conventions.
- **Action order matters:** `pnpm/action-setup` runs **before** `actions/setup-node`, because
  setup-node's `cache: pnpm` needs the pnpm binary to resolve the store path.
- **Hygiene:** least-privilege `permissions: contents: read` (the `commits` job adds `pull-requests:
  read`); a `concurrency` group cancels superseded runs on a branch; every action is pinned to a
  **full commit SHA** (`@<sha> # vX.Y.Z`; Dependabot bumps the SHA + comment) — immutable against a
  retagged/compromised action, which in CD would run with the Cloudflare token.
- **`test` is its own job, not folded into `verify`** — keeps one clean PR check per concern
  (distinct branch-protection targets) at the cost of a second `pnpm install`. After it runs once on
  a PR, add it to `main`'s required checks.
- **`shell` is checkout-only** — `shellcheck` and `bash` ship preinstalled on `ubuntu-latest`, so it
  needs no pnpm/node setup and no marketplace action (its only `uses:` is `checkout`, nothing extra to
  pin). Gotchas it encodes: `bash -n` checks only its *first* argument, so the syntax step **loops**
  over `scripts/*.sh`; and the shebang-less Husky hooks run under `/bin/sh` (dash on Linux), so
  they're linted with `--shell=sh`. Like `test`, add it to `main`'s required checks after its first PR run.
- **Supply-chain gates are split: `dependency-review` is a CI job, CodeQL is default setup.**
  `dependency-review` runs PR-only (it needs a base…head diff — a push to `main` has none) at
  least-privilege `contents: read` (no PR comment ⇒ no `pull-requests: write`); the `moderate`
  threshold blocks moderate/high/critical while skipping low-sev transitive noise, and the action's
  default `runtime` scope keeps dev-tooling advisories quiet. **CodeQL uses GitHub's *default setup*
  (a repo Settings toggle), not an advanced workflow file** — it's GitHub-hosted with nothing to
  SHA-pin, so unlike the CF-token-bearing CD actions the pinning threat model doesn't apply, and a
  scaffold with little app code gains nothing from custom query suites. Add both new checks
  (`dependency-review`, `CodeQL`) to `main`'s required set after their first PR run.

**Full setup, gotchas, and a from-scratch recipe:** [`docs/ci-setup.md`](docs/ci-setup.md) (keep it
updated when the setup itself changes).

## CD — Cloudflare Workers

CD lives in `.github/workflows/cd.yml` and deploys to **Cloudflare Workers** (Static Assets) across
three environments. Config is `wrangler.jsonc`: three **named environments** (`[env.dev/uat/prod]`),
each a separate Worker script (`crypto-order-book-{dev,uat,prod}`). Deploys always pass `--env`.
The thin Worker `worker/index.ts` serves static assets + per-env `/config.js` and `/api/health`
(`run_worker_first: ["/config.js", "/api/*"]` — the `/api/*` namespace is Worker territory, so
unmatched `/api/*` paths get a JSON **404** from the Worker, never the SPA fallback's
`index.html`); future API/DO/Container bindings attach to the env blocks and branch alongside
`/api/health`.

Triggers: **PR** → ephemeral preview URL (a non-promoted `wrangler versions upload --env dev`,
posted as a PR comment); **merge to `main`** → DEV; **tag `vX.Y.Z-rc.N`** → UAT; **tag `vX.Y.Z`** →
PROD, gated on the prod GitHub Environment's required reviewer. The prod/uat Environments also enforce
a **deployment tag policy** (prod `v*.*.*`, uat `v*.*.*-rc.*`).

Each deploy job gates traffic **behind** the smoke test: `wrangler versions upload` stages a new
version (routing no traffic), `scripts/smoke.sh` asserts that version's **preview URL** serves the
security headers + SPA shell marker on `/`, `nosniff` + the right `env` in `/config.js`,
`"status":"ok"` + the right `env` on `/api/health` (not just a `200`), and a JSON `404` (with
`nosniff`) for an unmatched `/api/*` path, then `wrangler versions deploy <id>@100 --yes` promotes it and the same script re-checks the
live URL — so a build that fails the smoke is never promoted (build-once preserved: upload uses the
downloaded artifact, no rebuild). `scripts/smoke.sh` is shared by both checks and lint-covered by CI's
`shell` job. The `build` job also **attests SLSA build provenance** for `dist-<sha>` (`actions/attest`),
and every deploy job **verifies** it (`scripts/verify-attestation.sh`) before promoting — an unattested
artifact never ships. Rollback stays manual — see the runbook in [`docs/cd-setup.md`](docs/cd-setup.md) §7.
**Workers Logs** are on via top-level `"observability": { "enabled": true }` in `wrangler.jsonc`
(logs are off by default; `observability` is inheritable, so the one block covers all three envs).

Invariants to preserve when editing the pipeline:

- `build` is **main-only**; UAT/PROD download the `dist-<sha>` artifact and **never rebuild** — do
  not add a tag trigger to `build` (it would break build-once *and* create a second artifact-producing
  run per SHA, tripping the cross-run resolver's "exactly one run" invariant). Only DEV shares a run
  with `build`; UAT/PROD depend on `classify` alone.
- the `build` job **attests SLSA provenance** for `dist-<sha>` (`actions/attest`) — keep `id-token:
  write` + `attestations: write` on it; every deploy job **verifies before promoting**
  (`scripts/verify-attestation.sh`) — keep `attestations: read` + the verify step. `actions/attest`
  bare (subject-path only) = build provenance; the attestation is out-of-band, so build-once
  byte-identity is untouched.
- env config is runtime via `/config.js`, **never `VITE_*`** (see Architecture / `src/lib/app-config.ts`).
- tag classification: `vX.Y.Z` → prod, `…-rc.N` → uat, else `none` (deploys nothing); a follow-on
  step also **rejects a non-increasing version core** (compared against the latest release tag),
  failing the job before any deploy.
- per-env `CLOUDFLARE_API_TOKEN` secrets; CF `Workers Scripts:Edit` is account-wide (so the win is
  revocable-per-env creds + prod-gating, not per-script lockdown).
- the `prod`/`uat` Environments enforce a **deployment tag policy** (`v*.*.*` / `v*.*.*-rc.*`, GitHub
  deployment-branch-policy `type: tag`) — a credential backstop to `classify`. **`dev` must stay
  open** (its Environment is shared with the `preview` job — a restriction there blocks PR previews).
  Setup + rollback runbook: [`docs/cd-setup.md`](docs/cd-setup.md) §5/§7.
- **cutting release tags: `pnpm release <patch|minor|major> [rc]`** (`scripts/release-tag.sh`) — you
  pick the bump; it computes the next tag off the latest release (same baseline as the gate, so it
  never collides/regresses), preflights the target commit (on main, up-to-date, live `dist-<sha>`
  artifact via `gh`), then tags + pushes plain git tags. A **final release pins to the tested `rc`'s
  commit** (build-once-promote) and attaches `gh` release notes (best-effort). We evaluated and
  **rejected release-please** for this financial-app model (its wins don't apply to a private app,
  it's weak on prereleases/UAT sign-off, and needs a prod-triggering write-scoped PAT).

**Live & protected:** configured and live on `*.timurjalilov1.workers.dev`; `main` is Strict
branch-protected (PR + the required CI checks, enforced on admins; CD checks not required).

**Full rationale, gotchas, deferred items, and setup steps:** [`docs/cd-setup.md`](docs/cd-setup.md)
(keep it updated when the setup itself changes).

## Dependency automation — Dependabot

`.github/dependabot.yml` drives **weekly** dependency PRs for two ecosystems — **npm** (pnpm) and
**github-actions**. Non-major updates are grouped (separate production/development PRs); majors come
individually for isolated review (except **`@types/node`**, whose major is pinned to the Node runtime —
see below). npm **and action** releases get a 7-day **cooldown** (supply-chain
hygiene); security updates bypass it and arrive immediately. `versioning-strategy: increase` (this is an app).
**Dependabot over Renovate:** native, zero-infra, matches the Actions-first posture.

Two integrations were required so Dependabot PRs stay green — both because of *existing* gates:

- **commitlint (a required check) vs Dependabot commit bodies.** `@commitlint/config-conventional`'s
  `body-max-line-length: 100` fails on Dependabot's long bodies → blocked PRs. Fixed by disabling
  `body-`/`footer-max-line-length` in the `package.json` `commitlint` block (core rules stay strict). The
  `commit-message.prefix` (`chore`/`ci`, **lowercase**) is **load-bearing** — it forces the subject verb to
  lowercase `bump` so `subject-case` passes; don't remove it.
- **CD `preview` job vs Dependabot's secret-less runs.** Dependabot PRs get a read-only token + no Actions
  secrets, so the token-dependent preview is guarded with `github.actor != 'dependabot[bot]'` (skips, not fails).

`cooldown` covers **both** ecosystems via `default-days`; the `semver-*-days` keys are actions-unsupported
(tags, not SemVer). An **`ignore`** rule holds **`@types/node` on its 24.x major** (semver-major bumps
suppressed) so the types can't outrun the pinned Node 24 runtime — minor/patch still flow; lift it (with
`.nvmrc` + `engines`) at the next Node LTS. Alerts/security updates are enabled in repo settings (separate
from version updates).
**Full rationale, gotchas & from-scratch recipe:** [`docs/dependabot-setup.md`](docs/dependabot-setup.md).

## Secrets

Never commit secrets / API keys. `.env*` is gitignored (except `.env.example`) — load config from
environment variables. **secretlint** (pre-commit, configured in `.secretlintrc.json` with the
recommended preset) scans every staged file as a safety net. Remember a browser SPA ships
everything to the client: exchange keys with trade/withdraw permissions must live behind a backend,
never in frontend code. **gitleaks** adds a deeper, full-history secret scan in CI (see
[CI — GitHub Actions](#ci--github-actions)) on top of secretlint's staged-file check. Per-env,
**non-secret** runtime config is served via the Worker's `/config.js` (not the bundle); Worker
*secrets* (when the backend needs them) go in `.dev.vars` locally (gitignored) and
`wrangler secret put` in deployed envs — never in `vars` in `wrangler.jsonc`, which are public.

## Architecture

- **Entry:** `index.html` (`#root`) → `src/main.tsx`, which guards the root element (no `!`
  assertion) and mounts `<ThemeProvider><App /></ThemeProvider>`.
- **Theming:** class-based dark mode — `ThemeProvider` (`src/components/theme-provider.tsx`)
  toggles `.dark` on the root element; consume state via `useTheme()` from
  `src/components/theme-context.ts` (the two-file split satisfies the strict Fast-Refresh rule).
  Persistence, system-theme reactivity, the **`d`** keybind, cross-tab sync, and the anti-flash
  swap — which **requires the CSP's `style-src 'unsafe-inline'`** — are chronicled in
  [`docs/theming-architecture.md`](docs/theming-architecture.md).
- **UI:** shadcn components live in `src/components/ui/` (`button.tsx` wraps
  `@base-ui/react`, styled with `class-variance-authority`). `cn()` in `src/lib/utils.ts`
  merges classes (`clsx` + `tailwind-merge`).
- **Styling:** Tailwind v4 in `src/index.css`. Design tokens (OKLch colors, radius, fonts)
  are defined in `@theme inline`; dark mode is wired via `@custom-variant dark (&:is(.dark *))`,
  which keys off the `.dark` class the theme provider toggles.
- **Path alias:** `@/*` → `src/*` (root `tsconfig.json` `paths` + `vite.config.ts`).
- **Hosting / Worker:** `worker/index.ts` is a thin Cloudflare Worker (its own runtime, no DOM).
  It serves the SPA's static assets (`env.ASSETS`), the per-env `/config.js`, and the first
  `/api/*` route, `/api/health` (`worker/health-response.ts` — JSON `{ status, env, now }`,
  smoke-asserted before every promote); unmatched `/api/*` paths return a JSON **404**
  (`worker/not-found-response.ts`) instead of falling through to the SPA fallback. All
  Worker-generated responses share one header builder (`worker/no-store-response.ts` —
  `no-store` + `nosniff`). The `runtimeConfig` Vite plugin serves local twins of all three
  routes in `pnpm dev` **and** `pnpm preview`. `wrangler.jsonc`
  defines the three envs (see [CD](#cd--cloudflare-workers)). `vite build` does **not** bundle the
  Worker — **wrangler** does, at deploy time.
- **Runtime config:** env-specific values reach the client at runtime via `/config.js`
  (`window.__APP_CONFIG__`), never `import.meta.env`. The Worker serves it per-env in deployed
  builds; a Vite plugin (`runtimeConfig` in `vite.config.ts`) both injects the
  `<script src="/config.js">` into `index.html` (so it's never bundled) and serves it in
  `pnpm dev` / `pnpm preview`.
  Read config through `src/lib/app-config.ts` (`getConfig()` / `AppConfig`).
- **Connection layer (part 1 of 3):** `src/lib/connection/ws-transport.ts` — an app-generic
  reconnecting WebSocket transport (full-jitter backoff, connect timeout, **opt-in** staleness
  watchdog, `subscribe`/`getState` store shaped for `useSyncExternalStore`). Protocol-agnostic:
  Binance specifics live in the order-book sync layer (part 2). Instances are
  **single-use** (`destroy()` is terminal) — consumers must follow the doc's consumer contract.
  **Full architecture, consumer contract, verified spec nuances & reuse recipe:**
  [`docs/ws-transport-architecture.md`](docs/ws-transport-architecture.md).
- **Order-book sync layer (part 2 of 3):** `src/lib/order-book/` — the Binance protocol brain.
  `createOrderBookSync()` (`order-book-sync.ts`) owns its transport, runs the spec's
  buffer→snapshot→stitch dance, verifies `U`/`u` continuity on every event, and recovers from
  ANY discontinuity by re-running the dance **in place** over the healthy socket (gap frames
  seed the next buffer). zod-validated payloads (`binance-schemas.ts`, tolerant of unknown
  keys); `BinanceHttpError extends HttpError` + `fetchDepthSnapshot` (`binance-rest.ts` —
  deliberately NOT via Query); Map-per-side book, sort-on-read (`book-levels.ts`); snapshot
  fetch failures retry forever (full-jitter, 30s floor after 429/418; `degraded` after 3 is
  advisory). Store shares its Maps by reference — safe by the rebuild-on-every-commit
  invariant. Single-use; consumed by the part-3 UI (the console demo that proved this layer is
  retired). Endpoints are
  Binance's market-data-only hosts via `/config.js` (`wsUrl`, `binanceRestUrl`) — env-identical
  by design, which is what keeps the CSP static. **Decision log (all 10 explicitly approved),
  spec verification, failure-mode matrix & reuse recipe:**
  [`docs/order-book-sync-architecture.md`](docs/order-book-sync-architecture.md).
- **Order-book UI (part 3 of 3):** `src/features/order-book/` — the rendering layer, a
  **manual** slot-keyed ladder (AG Grid was debated and reserved for a future blotter — a
  ladder isn't a grid). Hook-owned engine lifecycle (`use-order-book-sync.ts`,
  StrictMode-safe create-in-effect/destroy-in-cleanup; UI passes `depthLimit: 1000`); pure
  view-model (`order-book-view.ts` — sorted top-20, cumulative cross-side depth bars,
  `hasBook`, non-positive-spread guard); price-diffed level flashes (`use-level-flashes.ts`
  — never flash a rank shift, and only on a `live→live` commit so a resync doesn't flash
  the whole ladder); lossless string-truncation formatting (`order-book-format.ts` — never
  `toFixed` an exchange price); skeleton → live → stale-dimmed status UX with a visual-only
  status Badge plus two a11y live-region tiers (`use-status-announcement.ts` — polite
  region announces availability, assertive Alert announces problems, never both at once);
  one real `<table>`, no `aria-live` on streaming data. Built on
  shadcn Table/Badge/Skeleton/Card/Alert; `--bid`/`--ask` OKLch tokens
  (validator-checked). Tests inject a fake engine via the `createSync` seam
  (`src/test/fake-order-book-sync.ts`) — no module mocking. **Decision log, implementation
  amendments & reuse recipe:**
  [`docs/order-book-ui-architecture.md`](docs/order-book-ui-architecture.md).
- **Server-state / REST layer:** **TanStack Query v5**. `createQueryClient()`
  (`src/lib/query/query-client.ts`) owns the defaults (30s `staleTime`, never-retry-4xx/
  never-retry-`ParseError` predicate) and the `QueryCache`/`MutationCache` → `reportError()`
  seam; `fetchJson`/`HttpError`/`ParseError` (`src/lib/query/fetch-json.ts`) turn non-ok HTTP
  and unparseable 2xx bodies into typed throws. House rules: every resource
  is a `queryOptions()` module in its feature dir (no inline keys/fns in components — see
  `src/features/health/`), queryFns always forward `signal`, `useQuery` posture (suspense
  deferred), Query is for request/response state — streaming stays on the WS layer. Devtools
  plain-imported in `main.tsx` (self-excluded from prod). **Full decisions, contract, testing
  recipe & reuse steps:** [`docs/tanstack-query-setup.md`](docs/tanstack-query-setup.md).
- **Error handling:** a root error boundary (`RootErrorBoundary`, `src/components/root-error-boundary.tsx`,
  built on **`react-error-boundary`**) wraps the app in `src/main.tsx`; every error channel funnels through
  one **Sentry-ready** seam, `reportError()` in `src/lib/report-error.ts` (a one-line swap later). React 19's
  prod-only `createRoot` hooks + global `window` handlers cover what the boundary structurally can't (async /
  uncaught). **Full architecture, decisions & roadmap (per-widget boundaries, Sentry):**
  [`docs/error-handling-architecture.md`](docs/error-handling-architecture.md).
- **Security headers:** CSP + `nosniff`/`X-Frame-Options`/`Referrer-Policy`/`Permissions-Policy`/HSTS,
  split across **`public/_headers`** (document + assets; Vite copies it to `dist/`) and
  **`worker/no-store-response.ts`** (the shared builder setting `nosniff` on every Worker-generated
  response: `/config.js`, `/api/health`, the `/api` 404 — Cloudflare's `_headers` does **not**
  apply to Worker-generated responses). `script-src` stays a clean `'self'` (the load-bearing lock);
  `style-src` is `'self' 'unsafe-inline'` — the order-book grid (AG Grid) + Base UI popups inject runtime
  `<style>` elements, and locking `style-src` is ~0-value (CSS exfil is already closed by
  `img-src`/`font-src`/`default-src 'self'`). **`connect-src`/`style-src` are project-specific**;
  `connect-src` lists the order-book layer's two Binance market-data hosts — statically expressible
  in the build-once `_headers` file only because every env's `vars` carry the **same** hosts
  (deliberate); per-env origins would push the CSP into the Worker. HSTS is hygiene
  (`.dev` is already preload-forced).
  **Rationale, the coverage boundary & roadmap:** [`docs/security-headers-setup.md`](docs/security-headers-setup.md).
- **TypeScript:** `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`,
  `erasableSyntaxOnly`, `noUnusedLocals`/`noUnusedParameters`. Build uses project references
  (`tsc -b` over `tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.worker.json` — the last
  type-checks `worker/` against the generated `worker/worker-configuration.d.ts`; `types: []` keeps the
  worker project isolated from the app's DOM lib and every `@types/*`). Target
  es2023, `moduleResolution: "bundler"`. A 4th reference, `tsconfig.test.json`, type-checks test
  files with `vitest/globals` + jest-dom types — plus `vite/client`, so app modules a test imports can
  use `import.meta.env` (isolated from app/worker, like the worker project); see
  [Testing — Vitest](#testing--vitest).

## Conventions / gotchas

- Prefer **named exports** for components (`App`, `ThemeProvider`, `Button` are all named;
  avoid `export default` for components).
- Imports use the **explicit file extension** (e.g. `import { App } from "./App.tsx"`) —
  required by `allowImportingTsExtensions`.
- Outside `src/components/ui/**`, **do not co-locate non-component exports** (hooks, context,
  `cva` definitions) with components in the same file — split them into their own module. The
  strict `useComponentExportOnlyModules` rule will flag it.
- Never point Biome at CSS. Fix lint findings in code rather than suppressing them.
- **Never put env-specific config in `VITE_*` vars or `public/`.** It would be baked into the
  bundle (breaking build-once) or, for `public/config.js`, shadow the Worker's `/config.js` route.
  Env config is runtime-only via `/config.js`; the Worker uses `export default { fetch }` (a
  Worker requirement — exempt from the component-export rule since it's not a component).
- **Worker types are *generated*, not a dependency.** `worker/worker-configuration.d.ts` is produced by
  `pnpm cf-typegen` (`wrangler types … --include-env false`) from `wrangler.jsonc`'s `compatibility_date`
  and **committed**. Regenerate + commit after changing `compatibility_date` or bumping `wrangler`/`workerd`;
  CI's `cf-typegen:check` fails when it's stale. It's Biome-ignored (`!worker/worker-configuration.d.ts`)
  — never hand-edit it. Why it replaced an `@cloudflare/workers-types` devDep: [`docs/cd-setup.md`](docs/cd-setup.md).
- **Native build scripts are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).** pnpm 11
  blocks unapproved build scripts *and fails `pnpm <script>`* until each is resolved to `true`/
  `false` (never leave the `set this to true or false` placeholder). The non-obvious ones: `workerd:
  true` (Cloudflare runtime for local `wrangler dev`), `sharp: false` (transitive via miniflare for
  image emulation we don't use).
- **Node is locked to major 24 and *enforced*.** `engines.node: ">=24 <25"` in `package.json` +
  **`engineStrict: true`** in `pnpm-workspace.yaml` make `pnpm install` hard-fail on any other Node
  major. **Gotcha:** on pnpm 11 the `engines` field **alone only warns** (the docs' "always fails" is
  wrong for this version) — `engineStrict` is the switch that makes it an error, and it must live in
  `pnpm-workspace.yaml`, not `.npmrc` (pnpm 11 reads only auth/registry from `.npmrc`). `.nvmrc` still
  selects *which* 24.x; bump both together at the next LTS. Pairs with the `@types/node` major-ignore
  (see Dependabot).
- **pnpm self-manages its version — no Corepack.** `pmOnFail: download` in `pnpm-workspace.yaml` makes
  pnpm read `package.json`'s `packageManager` field and download+run the pinned version (verifying
  a signed release) when the local pnpm differs — so any global pnpm (v11+) converges on the repo's
  version. It's pnpm 11's *default*, pinned explicitly (immune to a future default flip; self-documenting,
  like `engineStrict`). **Gotcha:** `pmOnFail` supersedes **three** removed pnpm-11 settings —
  `managePackageManagerVersions`, `packageManagerStrict`, and `packageManagerStrictVersion` — plus the
  `COREPACK_ENABLE_STRICT` env var; don't reintroduce any of them. Its non-default values don't
  download: `error` fails on a version mismatch, `warn` warns and continues, `ignore` skips the check.
  CI is unaffected: `pnpm/action-setup` provisions pnpm from the same field, never Corepack.
  **Bump pnpm** by editing the `packageManager` field — but only to a release published to npm
  **≥7 calendar days ago** (`npm view pnpm time --json`) **and not deprecated**
  (`npm view pnpm@<version> deprecated`): a by-hand mirror of Dependabot's 7-day cooldown, which
  can't cover this field
  ([dependabot-core#4830](https://github.com/dependabot/dependabot-core/issues/4830)). Details + the
  incident behind the not-deprecated check: [`docs/dependabot-setup.md`](docs/dependabot-setup.md) §4.5.
- **Keep docs in sync:** on any **major change** (tooling, architecture, a new subsystem,
  scripts/hooks), update **both `README.md` and `CLAUDE.md`** in the same change.
