# CLAUDE.md

<!-- Guidance for working in this repository. **Keep this file under 200 lines** — longer files consume
more context and reduce adherence, so detail belongs in `docs/`. Working rules live in `.claude/rules/`. -->

## Overview

`crypto-order-book` — a React 19 + TypeScript SPA on Vite 8, Tailwind CSS v4 and shadcn/ui (`base-mira`
style, built on **Base UI** primitives — *not* Radix — with Tabler icons); package manager **pnpm**.
Status: **order book live end-to-end** — `src/App.tsx` renders the live BTCUSDT book in every env. Four
subsystems have landed: WebSocket transport, TanStack Query, Binance order-book sync, order-book UI —
the connection stack is complete. CI and CD are live and `main` is branch-protected.

This repo doubles as the **reference foundation** for future projects: every subsystem has a
`docs/<name>-{setup,architecture}.md` chronicle — decisions, gotchas, reuse recipe — and that chronicle
is the full detail behind the section here. Read it before changing a subsystem.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm preview` | Vite dev server / serve the production build |
| `pnpm build` | `tsc -b && vite build` — type-check via project refs, then bundle |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `test:run` / `test:ui` / `test:coverage` | vitest: watch / one-shot (CI + pre-push) / UI / v8 coverage |
| `pnpm check` | `biome check --write` — lint + format, safe fixes (`lint` / `format` do one half each) |
| `pnpm release <patch\|minor\|major> [rc]` | Compute the next tag off the latest release, preflight, tag + push (drives CD). `rc` → UAT candidate; `--dry-run`/`--yes` supported |
| `pnpm deploy:dev` / `:uat` / `:prod` | `wrangler deploy --env <name>` |
| `pnpm cf-typegen` / `:check` | Regenerate / staleness-check the committed Worker types (`:check` is a CI gate) |

## Linting & formatting — Biome

**Biome** (pinned exact) does lint *and* format, replacing ESLint + Prettier; config is
`biome.json`. Setup, gotchas, recipe: [`docs/biome-setup.md`](docs/biome-setup.md).

- **Scoped to `.ts`/`.tsx` only** — never point it at CSS: open upstream bugs parsing Tailwind v4's
  `@theme` / `@custom-variant` / `@plugin`. `.editorconfig` covers CSS/JSON/MD/YAML instead.
- `useComponentExportOnlyModules` stays **strict**; `src/components/ui/**` is exempted via `overrides`
  (vendored shadcn primitives co-locate `cva` variants by design).
- `noRestrictedImports` gates the **feature barrel**: the pattern `**/features/*/**` makes a deep import
  into `src/features/*` an error. Matched on the written specifier, not the resolved path.
- `useFilenamingConvention` pins filenames to `["camelCase", "PascalCase"]` — PascalCase components,
  camelCase everything else; vendored `src/components/ui/**` exempt. `.claude/rules/code-style.md`.
- **Fix lint findings in code — do not add `biome-ignore` / `eslint-disable`** unless unavoidable.

## Testing — Vitest

**Vitest 4** (pinned exact) + React Testing Library + jsdom; tests live beside their code as
`*.test.ts(x)`. Setup, gotchas, recipe: [`docs/vitest-setup.md`](docs/vitest-setup.md).

- `vitest.config.ts` `mergeConfig`s `vite.config.ts`, so tests inherit the `@`→`src` alias and plugins.
- Type isolation is a dedicated **`tsconfig.test.json`** (4th project reference, like the Worker's), so
  `pnpm build` type-checks tests too.
- Components touching `useQuery` render via `renderWithClient` (`src/test/renderWithClient.tsx`) —
  seed the cache before mount for fetch-free determinism.
- Assert via roles/text, not implementation details.

## Git hooks — Husky

**Husky 9**, self-installing via `"prepare": "husky"`; tracked hooks are `.husky/pre-commit`,
`.husky/commit-msg`, `.husky/pre-push`. Fast checks at commit, the whole build at push. Setup, gotchas,
recipe: [`docs/husky-setup.md`](docs/husky-setup.md).

- **pre-commit** → `lint-staged`: Biome on staged `*.{ts,tsx}` (re-staging safe fixes) + secretlint on
  *every* staged file. Only **errors** block.
- **commit-msg** → commitlint, enforcing Conventional Commits.
- **pre-push** → `pnpm build`, then `pnpm test:run`.
- Bypass: `HUSKY=0` skips install, `--no-verify` skips one run — CI re-runs everything regardless.

## CI — GitHub Actions

`.github/workflows/ci.yml` runs on PRs and pushes to `main` and is the **authoritative** gate — it
re-runs the local hooks' checks server-side, so bypassed hooks (`--no-verify`, `HUSKY=0`, web-UI commits)
can't land broken state. Six parallel jobs, one clean PR check each. Setup, gotchas, recipe:
[`docs/ci-setup.md`](docs/ci-setup.md).

- **`verify`** — `pnpm biome ci` + `pnpm build` (typecheck + bundle)
- **`test`** — `pnpm test:run`
- **`secrets`** — gitleaks over the full history
- **`commits`** — commitlint, PR-only
- **`shell`** — shellcheck + `bash -n` on `scripts/*.sh` and the Husky hooks
- **`dependency-review`** — PR-only; fails a PR adding a moderate-or-higher advisory

Code scanning is CodeQL's **default setup**, not a workflow file. Every action is pinned to a **full
commit SHA** — keep it that way, since CD runs actions with the Cloudflare token.

## CD — Cloudflare Workers

`.github/workflows/cd.yml` deploys to **Cloudflare Workers** (Static Assets); `wrangler.jsonc` defines
three **named environments** (`[env.dev|uat|prod]`), each its own Worker script, and deploys always pass
`--env`. Triggers: PR → ephemeral preview URL; merge to `main` → DEV; tag `vX.Y.Z-rc.N` → UAT; tag
`vX.Y.Z` → PROD, gated on a required reviewer. Live on `*.timurjalilov1.workers.dev`.

Invariants to preserve when editing the pipeline:

- `build` is **main-only**; UAT/PROD download the `dist-<sha>` artifact and **never rebuild**. Do not add
  a tag trigger to `build` — it breaks build-once *and* trips the resolver's "exactly one run" invariant.
- Traffic is gated **behind** the smoke test: `versions upload` stages a version routing no traffic,
  `scripts/smoke.sh` asserts it, then `versions deploy <id>@100` promotes and the same script re-checks
  live — so a build failing the smoke is never promoted.
- `build` **attests** SLSA provenance for `dist-<sha>` and every deploy job **verifies it before
  promoting** (`scripts/verify-attestation.sh`) — an unattested artifact never ships.
- Env config is runtime via `/config.js`, **never `VITE_*`**.
- Tag classification: `vX.Y.Z` → prod, `…-rc.N` → uat, else nothing; a **non-increasing version core is
  rejected** before any deploy. `prod`/`uat` Environments enforce a matching deployment tag policy as a
  credential backstop, but **`dev` must stay open** — its Environment is shared with the PR preview job.
- Releases are cut with **`pnpm release <patch|minor|major> [rc]`**, never by hand-tagging: a final
  release pins to the tested `rc`'s commit. Rollback is manual — runbook in
  [`docs/cd-setup.md`](docs/cd-setup.md) §7, which also holds the full rationale and setup steps.

## Dependency automation — Dependabot

`.github/dependabot.yml` drives **weekly** PRs for npm and github-actions: non-majors grouped
(production/development split), majors individual, 7-day **cooldown** on both that security updates
bypass. Rationale, gotchas, recipe: [`docs/dependabot-setup.md`](docs/dependabot-setup.md).

- The lowercase `commit-message.prefix` is **load-bearing — don't remove it**: it forces a lowercase
  subject verb so commitlint's `subject-case` passes.
- The `@types/node` major-`ignore` is **load-bearing** too — the types must not outrun the pinned Node 24.

## Secrets

Never commit secrets / API keys. `.env*` is gitignored (except `.env.example`) — load config from
environment variables. **secretlint** (pre-commit) scans every staged file and **gitleaks** adds a
full-history scan in CI (see [CI — GitHub Actions](#ci--github-actions)). Remember a browser SPA ships
everything to the client: exchange keys with trade/withdraw permissions must live behind a backend, never
in frontend code. Per-env **non-secret** config is served by the Worker's `/config.js`, not the bundle;
Worker *secrets* go in `.dev.vars` locally (gitignored) and `wrangler secret put` in deployed envs —
never in `vars` in `wrangler.jsonc`, which are public.

## Architecture

- **Entry:** `index.html` (`#root`) → `src/main.tsx`, which guards the root element (no `!` assertion).
- **Theming:** class-based dark mode — `ThemeProvider` toggles `.dark` on the root element; consume it via
  `useTheme()` from `src/components/themeContext.ts`. The anti-flash swap **requires the CSP's
  `style-src 'unsafe-inline'`**. [`docs/theming-architecture.md`](docs/theming-architecture.md)
- **UI / styling:** shadcn components in `src/components/ui/`; `cn()` in `src/lib/utils.ts` merges classes.
  Tailwind v4 lives in `src/index.css`, dark mode wired by `@custom-variant dark (&:is(.dark *))`.
- **Path alias:** `@/*` → `src/*` (root `tsconfig.json` `paths` + `vite.config.ts`).
- **Hosting / Worker:** `worker/index.ts` is a thin Worker (own runtime, no DOM) serving static assets,
  the per-env `/config.js` and `/api/health`. `/api/*` is Worker territory, so an unmatched `/api/*` path
  returns a JSON **404**, never the SPA fallback's `index.html`. Every Worker-generated response shares one
  header builder (`worker/noStoreResponse.ts`). Wrangler bundles the Worker at deploy time, not `vite`.
- **Runtime config:** env-specific values reach the client via `/config.js` (`window.__APP_CONFIG__`),
  never `import.meta.env`; read it through `src/lib/appConfig.ts` (`getConfig()`). The `runtimeConfig`
  Vite plugin injects the script tag so it's never bundled, and serves local twins of all three Worker
  routes in `pnpm dev` **and** `pnpm preview`.
- **Connection layer (1 of 3):** `src/lib/connection/wsTransport.ts` — an app-generic, protocol-agnostic
  reconnecting WebSocket transport; it already owns full-jitter backoff, connect timeout and an opt-in
  staleness watchdog. Instances are **single-use** (`destroy()` is terminal) and consumers must follow the
  doc's consumer contract. [`docs/ws-transport-architecture.md`](docs/ws-transport-architecture.md)
- **Order-book sync (2 of 3):** `src/lib/order-book/` — the Binance protocol brain.
  `createOrderBookSync()` owns its transport, runs the spec's buffer→snapshot→stitch dance, verifies
  `U`/`u` continuity per event and recovers from any discontinuity by re-running the dance in place over
  the healthy socket. zod-validated payloads; snapshot retries are forever. Single-use; consumed by the
  part-3 UI, console demo retired. [`docs/order-book-sync-architecture.md`](docs/order-book-sync-architecture.md)
- **Order-book UI (3 of 3):** `src/features/order-book/` — manual slot-keyed ladder, stacked layout, live.
  Conventions in that dir's `CLAUDE.md`; decisions in [`docs/order-book-ui-architecture.md`](docs/order-book-ui-architecture.md)
- **Server-state / REST:** **TanStack Query v5**. `createQueryClient()` owns the defaults (30s `staleTime`,
  never-retry-4xx/`ParseError`) and the cache → `reportError()` seam; `fetchJson` turns non-ok HTTP and
  unparseable 2xx bodies into typed throws. House rules: every resource is a `queryOptions()` module in its
  feature dir (no inline keys/fns in components), queryFns always forward `signal`, and Query is for
  request/response only — streaming stays on the WS layer. [`docs/tanstack-query-setup.md`](docs/tanstack-query-setup.md)
- **Error handling:** `RootErrorBoundary` wraps the app; every error channel funnels through one
  Sentry-ready seam, `reportError()` in `src/lib/reportError.ts`. React 19's prod-only `createRoot` hooks
  plus global `window` handlers cover the async/uncaught cases a boundary can't.
  [`docs/error-handling-architecture.md`](docs/error-handling-architecture.md)
- **Security headers:** CSP plus the hardening set and HSTS, split across **`public/_headers`** and
  **`worker/noStoreResponse.ts`** — Cloudflare's `_headers` does **not** apply to Worker-generated
  responses. `script-src` stays a clean `'self'` (the load-bearing lock); `connect-src`/`style-src` are
  project-specific, and the CSP can stay static in the build-once `_headers` only because every env's
  `vars` carry the **same** Binance hosts. [`docs/security-headers-setup.md`](docs/security-headers-setup.md)
- **TypeScript:** `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `erasableSyntaxOnly`,
  `noUnusedLocals`/`noUnusedParameters`; target es2023, `moduleResolution: "bundler"`. `tsc -b` builds
  four project references — app, node (no `strict`), worker (`types: []`, no DOM lib) and test.

## Conventions / gotchas

- **Never put env-specific config in `VITE_*` vars or `public/`.** It would be baked into the bundle
  (breaking build-once) or, for `public/config.js`, shadow the Worker's `/config.js` route. The Worker's
  `export default { fetch }` is exempt from `useComponentExportOnlyModules` — it isn't a component.
- **Worker types are generated, not a dependency.** `worker/worker-configuration.d.ts` comes from
  `pnpm cf-typegen` and is committed — never hand-edit it; the tracked copy must be regenerated after
  changing `compatibility_date` or bumping `wrangler`/`workerd` (CI's `cf-typegen:check` fails when stale).
- **Native build scripts are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`)** — the non-obvious
  entries: `workerd: true` (CF runtime for local `wrangler dev`), `sharp: false` (image emulation we don't use).
  pnpm 11 blocks unapproved ones *and* fails `pnpm <script>` until each is resolved to `true`/`false`;
  never leave the `set this to true or false` placeholder.
- **Node is locked to major 24 and enforced:** `engines.node` + **`engineStrict: true`** in
  `pnpm-workspace.yaml` hard-fail `pnpm install` on any other major (on pnpm 11 `engines` alone only
  warns). `.nvmrc` selects *which* 24.x — bump both together at the next LTS.
- **pnpm self-manages its version via `pmOnFail: download` — no Corepack.** Bump it by editing
  `packageManager`, but only to a release published **≥7 days ago** (`npm view pnpm time --json`) **and
  not deprecated** (`npm view pnpm@<version> deprecated`). The settings `pmOnFail` superseded, and why
  the not-deprecated check exists: [`docs/dependabot-setup.md`](docs/dependabot-setup.md) §4.5.
- **Keep docs in sync:** on any **major change** (tooling, architecture, a new subsystem, scripts/hooks),
  update **both `README.md` and `CLAUDE.md`** in the same change, plus the subsystem's `docs/` chronicle.
  Cross-cutting audit state lives in [`docs/production-readiness.md`](docs/production-readiness.md).
