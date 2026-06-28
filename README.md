# Crypto Order Book

A React 19 + TypeScript single-page app, built with Vite, Tailwind CSS v4, and shadcn/ui.

> **Status: early scaffold.** The app shell and theming are in place (the starter landing
> page with light/dark mode). Order-book functionality is not implemented yet — but the full
> CI **and** CD pipeline is live: every push deploys across DEV/UAT/PROD on Cloudflare Workers
> (see [Deployment](#deployment-cloudflare-workers)).

## Tech stack

- **React 19** + **TypeScript**
- **Vite 8** (dev server & build)
- **Tailwind CSS v4** for styling
- **shadcn/ui** (`base-lyra` style — built on [Base UI](https://base-ui.com) primitives) with
  **Tabler** icons
- **Biome** for linting & formatting
- **Vitest** + **React Testing Library** (jsdom) for unit / component tests
- **pnpm** for package management
- **Cloudflare Workers** (Static Assets) + **Wrangler** for hosting and deploys

## Getting started

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (default http://localhost:5173).

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the Vite dev server |
| `pnpm build` | Type-check (`tsc -b`) and build for production |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run tests in watch mode (`vitest`) |
| `pnpm test:run` | Run tests once (`vitest run`) — used by CI + pre-push |
| `pnpm test:ui` | Open the Vitest UI dashboard (`vitest --ui`) |
| `pnpm test:coverage` | Run tests with a coverage report (`vitest run --coverage`) |
| `pnpm typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `pnpm lint` | Lint with Biome |
| `pnpm format` | Format with Biome (`--write`) |
| `pnpm check` | Lint + format and apply safe fixes (`biome check --write`) |
| `pnpm deploy:dev` / `:uat` / `:prod` | Deploy to a Cloudflare Workers environment (`wrangler deploy --env <name>`) |
| `pnpm cf-typegen` | Generate Worker binding types from `wrangler.jsonc` (`wrangler types`) |

## Tooling

Linting and formatting are handled by a single tool, **[Biome](https://biomejs.dev)**, which
replaced ESLint + Prettier. Configuration is in `biome.json`. Quality is enforced locally by
[git hooks](#git-hooks). See [`CLAUDE.md`](./CLAUDE.md) for project conventions and the rationale
behind the setup.

For the full migration history, the decisions, and the gotchas, see [`docs/biome-setup.md`](docs/biome-setup.md).

## Testing

Tests run on **[Vitest](https://vitest.dev)** with **React Testing Library** in a jsdom environment.
Config is in `vitest.config.ts` (it extends `vite.config.ts`); tests live beside the code they cover
as `*.test.ts(x)`.

```bash
pnpm test          # watch mode
pnpm test:run      # one-shot (CI + pre-push)
pnpm test:coverage # with a v8 coverage report
```

For the full setup — the decisions, the gotchas, and a from-scratch recipe — see
[`docs/vitest-setup.md`](docs/vitest-setup.md).

## Git hooks

Git hooks run locally via **[Husky](https://typicode.github.io/husky)** and install themselves on
`pnpm install` (the `prepare` script):

- **pre-commit** — runs Biome (lint + format) and
  [secretlint](https://github.com/secretlint/secretlint) on staged files, auto-fixing and
  re-staging where safe.
- **commit-msg** — enforces [Conventional Commits](#commit-messages) (commitlint).
- **pre-push** — runs `pnpm build` then `pnpm test:run`, so type/bundle/test errors are caught
  before you push.

Bypass for a single command with `--no-verify` (e.g. `git commit --no-verify`), or skip hook
installation entirely with `HUSKY=0`.

For the full setup history, the decisions, and the gotchas, see [`docs/husky-setup.md`](docs/husky-setup.md).

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same gates on every
pull request and on push to `main`. CI is the authoritative check — it mirrors the local hooks on the
server, so nothing broken lands even if a hook was bypassed or skipped. Four jobs:

- **Lint, typecheck & build** — `biome ci` (read-only lint + format) then `pnpm build`
  (`tsc -b && vite build`).
- **Test (Vitest)** — `pnpm test:run` (`vitest run`); mirrors the pre-push test step.
- **Secret scan** — [gitleaks](https://github.com/gitleaks/gitleaks-action) over the full git history.
- **Commit messages** — [commitlint](#commit-messages) on the PR's commits (backstop to the local
  `commit-msg` hook).

Node is pinned via [`.nvmrc`](.nvmrc) (run `nvm use`) and pnpm via the `packageManager` field in
`package.json`, so local, hooks, and CI all run the same versions.

`main` is **branch-protected**: changes land via PR, and the required CI checks must pass (with the
branch up to date) before merging — enforced on admins too. Add the new **Test** check to the
required set once it has run on a PR. The CD checks are intentionally *not* required (they skip on
PRs or depend on Cloudflare).

For the full setup history, the decisions, and the gotchas, see [`docs/ci-setup.md`](docs/ci-setup.md).

## Deployment (Cloudflare Workers)

The app deploys to **Cloudflare Workers** with
[Static Assets](https://developers.cloudflare.com/workers/static-assets/) across three
environments — **DEV**, **UAT**, **PROD** — driven by
[`.github/workflows/cd.yml`](.github/workflows/cd.yml). Config lives in
[`wrangler.jsonc`](wrangler.jsonc), with three named environments (each its own Worker script:
`crypto-order-book-{dev,uat,prod}`). A thin Worker ([`worker/index.ts`](worker/index.ts)) serves
the SPA's static assets plus the per-environment runtime config, and is where API routes and
Durable Object / Container bindings will attach later.

For the full step-by-step setup history, the decisions, and the gotchas, see
[`docs/cd-setup.md`](docs/cd-setup.md).

### Release flow

| Trigger | Environment | Notes |
|---|---|---|
| Open / push to a PR | Preview | Ephemeral URL (a non-promoted version of the dev Worker), posted as a PR comment |
| Merge to `main` | **DEV** | Auto-deploy |
| Tag `vX.Y.Z-rc.N` | **UAT** | Release candidate |
| Tag `vX.Y.Z` | **PROD** | Blocked on the prod Environment's required-reviewer approval |

### Releasing — deploy to UAT / PROD

Day-to-day, after work has landed on `main`:

```bash
# DEV deploys automatically on merge to main — nothing to do.

# UAT — tag the (already-merged) commit with a release candidate:
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1

# PROD — once UAT looks good, tag the same commit with the release version:
git tag v0.1.0
git push origin v0.1.0
```

The PROD run then **pauses for approval**: go to **Actions → the running deploy → “Review
deployments” → check `prod` → Approve and deploy**. It promotes the same artifact UAT ran.

> **Ordering rule:** only tag a commit that has **landed on `main` and finished its `build`** — that
> run is what produced the `dist-<sha>` artifact the tag deploys promote. Tagging anything else fails
> the deploy loudly (by design) rather than silently rebuilding. A malformed tag (e.g. `v1.2`,
> `v1.2.3-beta`) classifies as `none` and deploys nothing, and a version that isn't higher than the
> latest release (a lower or duplicate number) is rejected by CI before any deploy.

**Rollback:** every deploy records a Worker version — roll back per env with `wrangler rollback`, or
re-tag/redeploy a previous good commit. Live URLs: `crypto-order-book-{dev,uat,prod}.timurjalilov1.workers.dev`.

### How it works (in brief)

- **Build once, promote the same bytes** — the bundle is built once on the merge to `main`
  (artifact `dist-<sha>`); UAT/PROD download and deploy *that* artifact, never rebuilding, so PROD
  ships exactly what UAT signed off on.
- **Runtime config, not build-time** — env values are served by the Worker at `/config.js`
  (`window.__APP_CONFIG__`), read via [`src/lib/app-config.ts`](src/lib/app-config.ts); **never**
  put env config in `VITE_*` vars or `public/`.
- **Per-environment deploy tokens** — each GitHub Environment holds its own revocable
  `CLOUDFLARE_API_TOKEN`, so the prod token is only exposed to the approval-gated prod job.

Full detail — the decisions, the account-wide-token caveat, and the gotchas — is in
[`docs/cd-setup.md`](docs/cd-setup.md).

### Setup

The pipeline is already configured and live. For the step-by-step setup — Cloudflare account,
tokens, and the `gh` commands for variables / environments / secrets — or to recreate it elsewhere,
see the **Manual setup** section of [`docs/cd-setup.md`](docs/cd-setup.md). Local deploys use
`pnpm deploy:dev` / `:uat` / `:prod`; `wrangler dev` runs the Worker + SPA locally (it needs the
`workerd` build — see the `allowBuilds` block in `pnpm-workspace.yaml`).

## Commit messages

Commits must follow [Conventional Commits](https://www.conventionalcommits.org) — the `commit-msg`
hook rejects anything else:

```
type(optional-scope): summary
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`,
`style`, `revert`. Examples:

```
feat(orderbook): render bid/ask depth chart
fix: correct websocket reconnect backoff
chore(hooks): add commitlint and secretlint
```

## Secrets

Never commit secrets or API keys. `.env*` files are gitignored (except `.env.example`) — load
config from environment variables. secretlint scans every staged file as a safety net. Remember a
browser app ships everything to the client: exchange keys with trade/withdraw permissions must live
behind a backend, never in frontend code.

Public, non-secret per-environment config is served at runtime via the Worker's `/config.js`
(see [Deployment](#deployment-cloudflare-workers)) — not baked into the bundle. Worker *secrets*,
when the backend needs them, belong in `.dev.vars` locally (gitignored) and `wrangler secret put`
in deployed envs — never in `vars` in `wrangler.jsonc` (those are world-readable).

## Adding components

To add shadcn/ui components, run:

```bash
npx shadcn@latest add button
```

This places UI components in `src/components/ui`. Import them via the `@` alias:

```tsx
import { Button } from "@/components/ui/button"
```
