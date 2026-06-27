# Crypto Order Book

A React 19 + TypeScript single-page app, built with Vite, Tailwind CSS v4, and shadcn/ui.

> **Status: early scaffold.** The app shell and theming are in place (the starter landing
> page with light/dark mode). Order-book functionality is not implemented yet.

## Tech stack

- **React 19** + **TypeScript**
- **Vite 8** (dev server & build)
- **Tailwind CSS v4** for styling
- **shadcn/ui** (`base-lyra` style — built on [Base UI](https://base-ui.com) primitives) with
  **Tabler** icons
- **Biome** for linting & formatting
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

## Git hooks

Git hooks run locally via **[Husky](https://typicode.github.io/husky)** and install themselves on
`pnpm install` (the `prepare` script):

- **pre-commit** — runs Biome (lint + format) and
  [secretlint](https://github.com/secretlint/secretlint) on staged files, auto-fixing and
  re-staging where safe.
- **commit-msg** — enforces [Conventional Commits](#commit-messages) (commitlint).
- **pre-push** — runs `pnpm build`, so type/bundle errors are caught before you push.

Bypass for a single command with `--no-verify` (e.g. `git commit --no-verify`), or skip hook
installation entirely with `HUSKY=0`.

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same gates on every
pull request and on push to `main`. CI is the authoritative check — it mirrors the local hooks on the
server, so nothing broken lands even if a hook was bypassed or skipped. Three jobs:

- **Lint, typecheck & build** — `biome ci` (read-only lint + format) then `pnpm build`
  (`tsc -b && vite build`).
- **Secret scan** — [gitleaks](https://github.com/gitleaks/gitleaks-action) over the full git history.
- **Commit messages** — [commitlint](#commit-messages) on the PR's commits (backstop to the local
  `commit-msg` hook).

Node is pinned via [`.nvmrc`](.nvmrc) (run `nvm use`) and pnpm via the `packageManager` field in
`package.json`, so local, hooks, and CI all run the same versions.

## Deployment (Cloudflare Workers)

The app deploys to **Cloudflare Workers** with
[Static Assets](https://developers.cloudflare.com/workers/static-assets/) across three
environments — **DEV**, **UAT**, **PROD** — driven by
[`.github/workflows/cd.yml`](.github/workflows/cd.yml). Config lives in
[`wrangler.jsonc`](wrangler.jsonc), with three named environments (each its own Worker script:
`crypto-order-book-{dev,uat,prod}`). A thin Worker ([`worker/index.ts`](worker/index.ts)) serves
the SPA's static assets plus the per-environment runtime config, and is where API routes and
Durable Object / Container bindings will attach later.

### Release flow

| Trigger | Environment | Notes |
|---|---|---|
| Open / push to a PR | Preview | Ephemeral URL (a non-promoted version of the dev Worker), posted as a PR comment |
| Merge to `main` | **DEV** | Auto-deploy |
| Tag `vX.Y.Z-rc.N` | **UAT** | Release candidate |
| Tag `vX.Y.Z` | **PROD** | Blocked on the prod Environment's required-reviewer approval |

### Build once, promote the same artifact

The production bundle is built **exactly once**, on the merge to `main`, and stored as a GitHub
Actions artifact keyed by commit SHA (`dist-<sha>`). UAT and PROD **download that artifact and
deploy the same bytes** — they never rebuild — so PROD ships precisely what UAT signed off on.
(The thin Worker is re-bundled by wrangler from the same tagged commit; only the static asset
bundle — what acceptance testing actually exercises — is promoted byte-for-byte.) Tagging a commit
that never landed on `main`, or whose artifact has aged out past the 90-day retention, fails the
deploy loudly rather than silently rebuilding.

### Runtime config — not build-time

Vite bakes `import.meta.env` / `VITE_*` values into the bundle at **build** time, which fights
build-once. Instead, **environment-specific config is served at runtime**: the Worker serves
`/config.js`, setting `window.__APP_CONFIG__` from the environment's `vars` (see `wrangler.jsonc`);
`pnpm dev` serves the same endpoint via a Vite middleware. Read it through
[`src/lib/app-config.ts`](src/lib/app-config.ts) — **never** put environment config in `VITE_*`
vars or in `public/` (a `public/config.js` would shadow the Worker route). This is what lets one
built artifact run unchanged in every environment.

### Scoped deploy tokens

Each GitHub Environment holds its **own** Cloudflare API token (a `CLOUDFLARE_API_TOKEN`
*environment* secret), so the prod token is only ever exposed to the approval-gated prod job and
each can be revoked independently.

> **Caveat (be precise about this):** Cloudflare's `Workers Scripts: Edit` permission is
> **account-wide** — a standard API token can't be locked to only the `crypto-order-book-prod`
> script. The real blast-radius wins are (a) independently revocable credentials per env and
> (b) gating the prod token behind the prod Environment's approval. True per-resource isolation
> would require separate Cloudflare accounts per env (overkill here).

### First-time setup

The pipeline is **inert until configured** — the deploy jobs skip while `CLOUDFLARE_ACCOUNT_ID` is
unset, so CI stays green until you opt in. To activate it:

1. **Cloudflare** — note your **Account ID** (dashboard → Workers & Pages) and your `*.workers.dev`
   **subdomain** (the label before `.workers.dev`).
2. **Three API tokens** — dashboard → My Profile → API Tokens → *Create Token* →
   **"Edit Cloudflare Workers"** template. One each for dev / uat / prod.
3. **GitHub variables, environments & secrets** (run from the repo, with the `gh` CLI):

   ```bash
   # Repo variables (not secret) — also the on-switch for the deploy jobs
   gh variable set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
   gh variable set WORKERS_SUBDOMAIN     --body "<your-subdomain>"

   # Environments (prod gets you as a required reviewer)
   gh api -X PUT repos/{owner}/{repo}/environments/dev
   gh api -X PUT repos/{owner}/{repo}/environments/uat
   gh api -X PUT repos/{owner}/{repo}/environments/prod --input - <<EOF
   {"reviewers":[{"type":"User","id":$(gh api user --jq .id)}]}
   EOF

   # Per-environment deploy tokens (paste each token when prompted)
   gh secret set CLOUDFLARE_API_TOKEN --env dev
   gh secret set CLOUDFLARE_API_TOKEN --env uat
   gh secret set CLOUDFLARE_API_TOKEN --env prod
   ```

Local deploys use `pnpm deploy:dev` / `:uat` / `:prod`; `wrangler dev` runs the Worker + SPA
locally (it needs the `workerd` build — see the `allowBuilds` block in `pnpm-workspace.yaml`).

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
