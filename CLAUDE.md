# CLAUDE.md

Guidance for working in this repository.

## Overview

`crypto-order-book` — a React 19 + TypeScript single-page app built with Vite 8, Tailwind
CSS v4, and shadcn/ui (the `base-lyra` style, which uses **Base UI** primitives — not Radix —
and Tabler icons). Package manager is **pnpm**.

> Status: **early scaffold**. The app currently renders the shadcn starter landing page
> (`src/App.tsx`) with theming wired up. There is no order-book domain code yet. The CI **and**
> CD pipelines exist (three-env Cloudflare Workers deploy; CD is inert until credentials are set).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | `tsc -b && vite build` (type-checks via project refs, then bundles) |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome lint` (read-only) |
| `pnpm format` | `biome format --write` |
| `pnpm check` | `biome check --write` (lint + format, applies safe fixes) |
| `pnpm deploy:dev` / `:uat` / `:prod` | `wrangler deploy --env <name>` to a Cloudflare Workers env |
| `pnpm cf-typegen` | `wrangler types` — regenerate Worker binding types from `wrangler.jsonc` |

## Linting & formatting — Biome

A single tool, **Biome 2.5.1** (pinned exact in `package.json`), handles both linting and
formatting. It replaced ESLint + Prettier. Config lives in `biome.json`.

- **Scoped to `.ts`/`.tsx` only.** Biome deliberately does **not** touch CSS or JSON. Do not
  add CSS to its scope: Biome has open upstream bugs parsing Tailwind v4 at-rules
  (`@theme`, `@custom-variant`, `@plugin`), and Vite/Tailwind already own `src/index.css`.
- **Formatter:** 2-space indent, double quotes, no semicolons, `es5` trailing commas, 80-col
  width, LF. (Matches the project's previous Prettier config byte-for-byte.)
- **Linter:** `recommended` preset + the `react` domain. `useComponentExportOnlyModules` is
  kept **strict (`error`)**. `src/components/ui/**` is exempted from it via `overrides`
  (vendored shadcn primitives co-locate `cva` variants with components by design).
- Import organizing is **off** (`assist` disabled). There is **no Tailwind class sorting**
  (dropped with `prettier-plugin-tailwindcss`; Biome has no equivalent).
- **Convention: fix lint findings in code. Do not add `biome-ignore` / `eslint-disable`**
  unless genuinely unavoidable — exhaust refactors first.

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
- **`pre-push` → `pnpm build`.** Runs the *real* build (`tsc -b && vite build`) before a push, so
  type/bundle breakage is caught locally rather than in CI. (`pnpm test` joins here once vitest lands.)
- **Skipping:** `HUSKY=0` skips hook install (Docker/CI); `git commit --no-verify` /
  `git push --no-verify` bypass for a single run. For GUI/IDE commits that don't load your Node
  version manager, put its init in `~/.config/husky/init.sh`.

## CI — GitHub Actions

CI lives in `.github/workflows/ci.yml` and runs on **pull requests** and **pushes to `main`**. It is
the *authoritative* gate — it re-runs the local hooks' checks on the server, so bypassed/skipped hooks
(`--no-verify`, `HUSKY=0`, commits made via GitHub's web UI) can't land broken state. Three parallel
jobs, each a distinct PR check (clean targets for branch protection):

- **`verify`** — the only job that installs deps: `pnpm install --frozen-lockfile`, then `pnpm biome ci`
  (read-only lint + format, emits GitHub annotations) and `pnpm build` (`tsc -b && vite build` —
  typecheck + bundle). Mirrors the pre-commit Biome and pre-push build hooks.
- **`secrets`** — `gitleaks/gitleaks-action@v3` with `fetch-depth: 0` (full-history scan), a deep
  backstop to the staged-file secretlint hook. Free for personal accounts; under a GitHub **org** it
  needs a free `GITLEAKS_LICENSE` secret.
- **`commits`** — `wagoid/commitlint-github-action@v6`, PR-only; reads the same `commitlint` config
  from `package.json`. Backstop to the local `commit-msg` hook (catches `--no-verify` / web-UI commits).

Design decisions:

- **Biome runs via the pinned devDependency (`pnpm biome ci`), not `biomejs/setup-biome`.** Biome is
  pinned exact (2.5.1); using the project's own copy guarantees CI and local lint identically — the
  setup-biome action with `version: latest` would risk drift.
- **Single source of truth for versions.** Node via `.nvmrc` (`24`), consumed by setup-node's
  `node-version-file` and by `nvm use`; pnpm via `package.json`'s `packageManager` field
  (`pnpm@11.9.0`), auto-detected by `pnpm/action-setup@v6` so the workflow hardcodes no pnpm version.
- **Action order matters:** `pnpm/action-setup` runs **before** `actions/setup-node`, because
  setup-node's `cache: pnpm` needs the pnpm binary to resolve the store path.
- **Hygiene:** least-privilege `permissions: contents: read` (the `commits` job adds `pull-requests:
  read`); a `concurrency` group cancels superseded runs on a branch; actions are pinned to major tags.
- **No `test` job yet** — a Vitest job (same setup as `verify`) lands when tests do, matching the
  `pnpm test` TODO in `.husky/pre-push`.

## CD — Cloudflare Workers

CD lives in `.github/workflows/cd.yml` and deploys to **Cloudflare Workers** (Static Assets) across
three environments. Config is `wrangler.jsonc`: three **named environments** (`[env.dev/uat/prod]`),
each a separate Worker script (`crypto-order-book-{dev,uat,prod}`). Deploys always pass `--env`.
The thin Worker `worker/index.ts` serves static assets + per-env `/config.js`; future API/DO/Container
bindings attach to the env blocks (`run_worker_first: ["/api/*"]`).

Triggers: **PR** → ephemeral preview URL (a non-promoted `wrangler versions upload --env dev`,
posted as a PR comment); **merge to `main`** → DEV; **tag `vX.Y.Z-rc.N`** → UAT; **tag `vX.Y.Z`** →
PROD, gated on the prod GitHub Environment's required reviewer.

Design decisions (the depth an interviewer probes):

- **Build once, promote the same artifact.** The SPA bundle is built **exactly once**, on the
  `main` merge (`build` job, `if: push && ref == refs/heads/main`), and stored as `dist-<sha>`.
  UAT/PROD **download that artifact** (cross-run, via a `gh run list --commit <sha> --branch main`
  lookup that fails loudly on ≠1 match) and deploy the same bytes — they **never rebuild**.
  `build` must stay main-only: rebuilding on a tag would break the guarantee *and* create a second
  artifact-producing run per SHA, tripping the resolver's "exactly one" invariant. Only DEV shares
  a run with `build`; UAT/PROD depend on `classify` alone (not `build`, which is skipped on tags).
  *Nuance:* only the static asset bundle is promoted byte-for-byte; the thin Worker is re-bundled
  by wrangler from the same tagged commit (deterministic, trivial).
- **Runtime config, not build-time.** Vite bakes `VITE_*` at build time, fighting build-once. So
  env config is served at runtime via `/config.js` (`window.__APP_CONFIG__`) from the Worker's
  `vars`; never bake env config into the bundle. See Architecture / `src/lib/app-config.ts`.
- **Tag classification.** `on:` globs can't tell `v1.2.3` from `v1.2.3-rc.1`, so a `classify` job
  regex-matches `github.ref_name` (`^v\d+\.\d+\.\d+$` → prod, `…-rc\.\d+$` → uat, else → `none`)
  and deploy jobs gate on its output — a stray/malformed tag deploys nothing.
- **`pnpm exec wrangler`, not `cloudflare/wrangler-action`.** Same reasoning as `pnpm biome ci`
  over `biomejs/setup-biome`: the action installs its own wrangler and would drift from the
  lockfile-pinned devDep.
- **Per-environment deploy tokens.** Each GitHub Environment holds its own `CLOUDFLARE_API_TOKEN`
  secret, so the prod token is only exposed to the approval-gated prod job. **Honest caveat:**
  Cloudflare's `Workers Scripts: Edit` is **account-wide** — a token can't be scoped to one script;
  the real wins are revocable-per-env creds + approval-gating, not per-resource lockdown.
- **Inert until configured.** Deploy/preview jobs gate on `vars.CLOUDFLARE_ACCOUNT_ID != ''`, so
  the workflow no-ops (no red X) until the repo variable + per-env secrets are set. Setup steps:
  README → Deployment → First-time setup.
- **Later, not v1:** gradual/canary prod rollout (`wrangler versions deploy <id>@<pct> --yes`),
  R2-keyed artifacts for longer retention, custom domains, the HTMLRewriter SPA-shell config
  variant, and a `secrets`/`commits`-style note if those land.

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
- **Theming:** split across two files (deliberately, to satisfy the strict Fast-Refresh
  rule):
  - `src/components/theme-provider.tsx` — the `ThemeProvider` component (only export). Toggles
    a `.dark` class on the root element, persists to `localStorage`, detects the system theme,
    and toggles light/dark on the **`d`** keypress.
  - `src/components/theme-context.ts` — `ThemeProviderContext`, the `useTheme` hook, and the
    `Theme` type (`"dark" | "light" | "system"`). Consume theme state via `useTheme()`.
- **UI:** shadcn components live in `src/components/ui/` (`button.tsx` wraps
  `@base-ui/react`, styled with `class-variance-authority`). `cn()` in `src/lib/utils.ts`
  merges classes (`clsx` + `tailwind-merge`).
- **Styling:** Tailwind v4 in `src/index.css`. Design tokens (OKLch colors, radius, fonts)
  are defined in `@theme inline`; dark mode is wired via `@custom-variant dark (&:is(.dark *))`,
  which keys off the `.dark` class the theme provider toggles.
- **Path alias:** `@/*` → `src/*` (root `tsconfig.json` `paths` + `vite.config.ts`).
- **Hosting / Worker:** `worker/index.ts` is a thin Cloudflare Worker (its own runtime, no DOM).
  It serves the SPA's static assets (`env.ASSETS`) and the per-env `/config.js`. `wrangler.jsonc`
  defines the three envs (see [CD](#cd--cloudflare-workers)). `vite build` does **not** bundle the
  Worker — **wrangler** does, at deploy time.
- **Runtime config:** env-specific values reach the client at runtime via `/config.js`
  (`window.__APP_CONFIG__`), never `import.meta.env`. The Worker serves it per-env in deployed
  builds; a Vite plugin (`runtimeConfig` in `vite.config.ts`) both injects the
  `<script src="/config.js">` into `index.html` (so it's never bundled) and serves it in `pnpm dev`.
  Read config through `src/lib/app-config.ts` (`getConfig()` / `AppConfig`).
- **TypeScript:** `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`,
  `erasableSyntaxOnly`, `noUnusedLocals`/`noUnusedParameters`. Build uses project references
  (`tsc -b` over `tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.worker.json` — the last
  type-checks `worker/` with `@cloudflare/workers-types`, isolated from the app's DOM lib). Target
  es2023, `moduleResolution: "bundler"`.

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
- **Native build scripts are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).** pnpm 11
  blocks unapproved build scripts *and fails `pnpm <script>`* until each is resolved to `true`/
  `false` (never leave the `set this to true or false` placeholder). Current calls: `workerd: true`
  (Cloudflare runtime for local `wrangler dev`), `sharp: false` (transitive via miniflare for image
  emulation we don't use).
- **Keep docs in sync:** on any **major change** (tooling, architecture, a new subsystem,
  scripts/hooks), update **both `README.md` and `CLAUDE.md`** in the same change.
