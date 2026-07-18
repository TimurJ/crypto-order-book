# Crypto Order Book

A React 19 + TypeScript single-page app, built with Vite, Tailwind CSS v4, and shadcn/ui.

> **Status: early scaffold.** The app shell and theming are in place (the starter landing
> page with light/dark mode). The first domain subsystem — a resilient WebSocket transport
> (`src/lib/connection/`) — has landed; the order-book sync + rendering layers on top of it
> are not implemented yet. The full CI **and** CD pipeline is live: every push deploys across
> DEV/UAT/PROD on Cloudflare Workers (see [Deployment](#deployment-cloudflare-workers)).
> The repo also serves as a **reference foundation** for future projects — every subsystem is
> chronicled in [`docs/`](docs/).

## Tech stack

- **React 19** + **TypeScript**
- **Vite 8** (dev server & build)
- **Tailwind CSS v4** for styling, with class-based light/dark theming (see
  [`docs/theming-architecture.md`](docs/theming-architecture.md))
- **shadcn/ui** (`base-mira` style — built on [Base UI](https://base-ui.com) primitives) with
  **Tabler** icons
- **react-error-boundary** for a top-level error boundary + a central error-reporting seam (see
  [`docs/error-handling-architecture.md`](docs/error-handling-architecture.md))
- A hand-rolled **resilient WebSocket transport** with automatic reconnection (see
  [`docs/ws-transport-architecture.md`](docs/ws-transport-architecture.md))
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

> **Prerequisite: Node 24** (pinned in [`.nvmrc`](.nvmrc) — `nvm use`) and **pnpm** installed
> globally (v11+ — e.g. `npm i -g pnpm` or the [standalone installer](https://pnpm.io/installation)).
> pnpm pins *itself* to the version in `package.json`'s `packageManager` field via `pmOnFail: download`
> (`pnpm-workspace.yaml`), so `pnpm install` always runs that exact version regardless of your global
> version. The Node version is **enforced** at `pnpm install`, not just advised — see
> [Continuous integration](#continuous-integration) for how.

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
| `pnpm release <patch\|minor\|major> [rc]` | Compute + push the next release tag off the latest release (add `rc` for a UAT candidate; `--dry-run` to preview). Drives the CD deploy. |
| `pnpm deploy:dev` / `:uat` / `:prod` | Deploy to a Cloudflare Workers environment (`wrangler deploy --env <name>`) |
| `pnpm cf-typegen` | Regenerate the committed `worker/worker-configuration.d.ts` (runtime types from `wrangler.jsonc`'s `compatibility_date`) |
| `pnpm cf-typegen:check` | Fail if that generated file is stale vs `wrangler.jsonc` (used by CI) |

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
server, so nothing broken lands even if a hook was bypassed or skipped. Six jobs:

- **Lint, typecheck & build** — `biome ci` (read-only lint + format) then `pnpm build`
  (`tsc -b && vite build`).
- **Test (Vitest)** — `pnpm test:run` (`vitest run`); mirrors the pre-push test step.
- **Secret scan** — [gitleaks](https://github.com/gitleaks/gitleaks-action) over the full git history.
- **Dependency review** — [dependency-review](https://github.com/actions/dependency-review-action)
  blocks a PR that adds a dependency with a moderate-or-higher known advisory (PR-only).
- **Commit messages** — [commitlint](#commit-messages) on the PR's commits (backstop to the local
  `commit-msg` hook).
- **Shell lint** — [shellcheck](https://www.shellcheck.net) + `bash -n` on `scripts/*.sh`, plus
  `shellcheck` (as POSIX `sh`) on the Husky hooks, so the release helper stays portable across WSL and macOS.

Every action the two workflows call is pinned to a **full commit SHA** (`@<sha> # vX.Y.Z`), so a
retagged action can't change what runs — Dependabot bumps the SHA and its comment on its weekly run.

Node is pinned via [`.nvmrc`](.nvmrc) (run `nvm use`) and pnpm via the `packageManager` field in
`package.json`, so local, hooks, and CI all run the same versions. When bumping the pnpm pin, choose a
release published **≥7 calendar days ago** (`npm view pnpm time --json`) **and not deprecated**
(`npm view pnpm@<version> deprecated`) — a manual stand-in for Dependabot's cooldown, which can't
update that field. The Node major is **enforced**, not
just advised — an `engines.node: ">=24 <25"` gate (with `engineStrict: true` in `pnpm-workspace.yaml`)
makes `pnpm install` hard-fail on Node 22/26, on every machine and in CI.

`main` is **branch-protected**: changes land via PR, and the required CI checks must pass (with the
branch up to date) before merging — enforced on admins too. Add newly-landed checks (**Test**,
**Shell lint**, **Dependency review**, and — once the maintainer enables CodeQL default setup —
**CodeQL**) to the required set once they have first run on a PR. The CD checks are intentionally
*not* required (they skip on PRs or depend on Cloudflare).

For the full setup history, the decisions, and the gotchas, see [`docs/ci-setup.md`](docs/ci-setup.md).

## Dependency updates

[Dependabot](https://docs.github.com/en/code-security/dependabot) keeps dependencies and the pinned
GitHub Actions current, configured in [`.github/dependabot.yml`](.github/dependabot.yml). It opens
**weekly** PRs for two ecosystems — npm (pnpm) and github-actions — batching non-major updates into
grouped PRs (separate production / development) while leaving majors as individual PRs for isolated
review — except **`@types/node`**, whose major is held to the Node 24 runtime (an `ignore` rule; minor/patch
still flow). New releases (npm packages **and** pinned actions) are held for a 7-day **cooldown** before bumping
(supply-chain hygiene); security updates bypass the cooldown and arrive immediately.

Dependabot PRs run the full CI suite and must pass the same required checks as any other PR. Two
integration notes: its commit messages carry a `chore(deps)` / `ci(deps)` prefix so they satisfy the
Conventional-Commits check, and the CD preview job is skipped for them (Dependabot runs get no access to
deploy secrets). Dependabot **alerts** and **security updates** are enabled in the repo's security
settings (separate from the version updates above).

For the full setup — the decisions, the gotchas, and a from-scratch recipe — see
[`docs/dependabot-setup.md`](docs/dependabot-setup.md).

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
| Tag `vX.Y.Z` | **PROD** | Blocked on the prod Environment's required-reviewer approval; only deployable from `vX.Y.Z` tags (Environment tag policy) |

### Releasing — deploy to UAT / PROD

Day-to-day, after work has landed on `main`, use **`pnpm release`** — you choose the bump; it finds
the latest release, computes the next tag, runs preflight checks, then tags and pushes:

```bash
# DEV deploys automatically on merge to main — nothing to do.

# UAT — cut a release candidate (rc.N auto-increments):
pnpm release patch rc      # e.g. v0.1.0 -> v0.1.1-rc.1

# PROD — once UAT looks good, cut the release. It pins to the exact commit the tested
# rc points to (so PROD ships byte-for-byte what UAT ran) and attaches release notes:
pnpm release patch         # -> v0.1.1

# Preview without tagging:
pnpm release minor --dry-run
```

`patch|minor|major` is your call (never derived from commits). Add `rc` for a UAT candidate;
`--dry-run` previews; `--yes` skips the confirmation prompt. The script pushes plain git tags, so
the existing `cd.yml` triggers exactly as before — it's just the version math + preflight automated.

A **final release requires a matching `-rc.*` that's already on `origin`** (proof it deployed to
UAT); the preflight blocks otherwise. To ship `main` HEAD straight to PROD without a UAT candidate,
pass `--allow-no-rc` explicitly (`--yes` alone won't bypass this).

The PROD run then **pauses for approval**: go to **Actions → the running deploy → “Review
deployments” → check `prod` → Approve and deploy**. It promotes the same artifact UAT ran.

> **Ordering rule:** only tag a commit that has **landed on `main` and finished its `build`** — that
> run is what produced the `dist-<sha>` artifact the tag deploys promote. Tagging anything else fails
> the deploy loudly (by design) rather than silently rebuilding. A malformed tag (e.g. `v1.2`,
> `v1.2.3-beta`) classifies as `none` and deploys nothing, and a version that isn't higher than the
> latest release (a lower or duplicate number) is rejected by CI before any deploy.

**Rollback:** every **upload** records a Worker version (the promote only shifts traffic to it), so
re-promoting a known-good version is one command away
(`wrangler versions deploy <prev-id>@100 --env <env> --yes`). Full step-by-step in the
[rollback runbook](docs/cd-setup.md#7-operating-it). Live URLs:
`crypto-order-book-{dev,uat,prod}.timurjalilov1.workers.dev`.

### How it works (in brief)

- **Build once, promote the same bytes** — the bundle is built once on the merge to `main`
  (artifact `dist-<sha>`); UAT/PROD download and deploy *that* artifact, never rebuilding, so PROD
  ships exactly what UAT signed off on.
- **Build provenance (SLSA)** — the `build` job attests the bundle with
  [`actions/attest`](https://github.com/actions/attest), and each deploy **verifies** that signed
  provenance ([`scripts/verify-attestation.sh`](scripts/verify-attestation.sh)) before promoting, so
  every file it ships is provably from the build.
- **Runtime config, not build-time** — env values are served by the Worker at `/config.js`
  (`window.__APP_CONFIG__`), read via [`src/lib/app-config.ts`](src/lib/app-config.ts); **never**
  put env config in `VITE_*` vars or `public/`.
- **Per-environment deploy tokens** — each GitHub Environment holds its own revocable
  `CLOUDFLARE_API_TOKEN`, so the prod token is only exposed to the approval-gated prod job. Each
  gated Environment also restricts *which tags* can deploy (prod `v*.*.*`, uat `v*.*.*-rc.*`), a
  credential backstop on top of the tag classification (dev stays open — it's shared with `preview`).
- **Traffic gated behind the smoke test** — each deploy `wrangler versions upload`s a new version
  (serving no traffic), runs [`scripts/smoke.sh`](scripts/smoke.sh) against that version's **preview
  URL** — asserting the security headers + SPA shell marker on `/` and `nosniff` + the right `env` in
  `/config.js`, not just a `200` — and only then promotes it to 100% (`wrangler versions deploy
  <id>@100 --yes`), so a build that **fails the smoke** is never promoted and the previous version
  keeps serving. The same script re-checks the live URL to confirm the cutover.
- **Workers Logs on** — `observability` is enabled in [`wrangler.jsonc`](wrangler.jsonc) (off by
  default), so logs and uncaught exceptions are captured for every env.

Full detail — the decisions, the account-wide-token caveat, and the gotchas — is in
[`docs/cd-setup.md`](docs/cd-setup.md).

### Setup

The pipeline is already configured and live. For the step-by-step setup — Cloudflare account,
tokens, and the `gh` commands for variables / environments / secrets — or to recreate it elsewhere,
see the **Manual setup** section of [`docs/cd-setup.md`](docs/cd-setup.md). Local deploys use
`pnpm deploy:dev` / `:uat` / `:prod`; `wrangler dev` runs the Worker + SPA locally (it needs the
`workerd` build — see the `allowBuilds` block in `pnpm-workspace.yaml`).

## Security headers

Responses are hardened with a CSP plus `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, and HSTS. They live in **two** places, split along a hard
Cloudflare boundary:

- [`public/_headers`](public/_headers) — applied by Static Assets to the document + bundled assets
  (Vite copies it to `dist/`). This is where the CSP and `frame-ancestors` actually matter.
- [`worker/config-response.ts`](worker/config-response.ts) — sets `nosniff` on `/config.js`, because
  Cloudflare's `_headers` does **not** apply to Worker-generated responses.

Verify locally:

```bash
pnpm build && pnpm exec wrangler dev --env dev
curl -sI http://localhost:8787/           # full header set from _headers
curl -sI http://localhost:8787/config.js  # nosniff + no-store from the Worker (no CSP — proves the split)
```

> **`connect-src` / `style-src` are project-specific** — `_headers` ships unchanged to all three
> envs (build-once-promote), so per-env exchange `wss://` origins will eventually push the CSP into
> the Worker. `script-src` stays a strict `'self'`; `style-src` is `'self' 'unsafe-inline'` for the
> order-book grid + Base UI popup `<style>` injection (locking it is ~0-value).
> Rationale, the HSTS-on-`.dev` nuance, and the roadmap: [`docs/security-headers-setup.md`](docs/security-headers-setup.md).

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

## License

**Proprietary — all rights reserved.** This source is published for demonstration/portfolio
purposes only; it is **not** open-source, and no permission is granted to use, copy, modify, or
distribute it without prior written consent. See [`LICENSE`](LICENSE).
