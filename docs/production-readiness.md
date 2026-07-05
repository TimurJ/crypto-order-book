# Production Readiness Audit

A grounded audit of what `crypto-order-book` still needs to be production-ready, based on the
actual state of the repo (source, both CI/CD workflows, wrangler/vite config, gitignore).

> **Status context:** This is still an **early scaffold** — `src/App.tsx` is the shadcn starter
> page and there's no order-book domain code yet. The tooling/CI/CD foundation (Biome, git hooks,
> GitHub Actions, three-env Cloudflare CD) is strong. The single most important "production-ready"
> need is the actual app; everything below is the foundation to lay before/alongside the features.

Items are ordered by impact. Tier 1 closes real holes; Tier 2 is production operations; Tier 3 is
polish.

---

## Tier 1 — Real gaps (do alongside the first features)

### 1. Automated tests — the missing pillar of the quality gate ✅ DONE
- [x] Add **Vitest 4 + React Testing Library + jsdom** (`vitest.config.ts`, `src/test/setup.ts`)
- [x] Add `test` scripts to `package.json` (`test`, `test:run`, `test:ui`, `test:coverage`)
- [x] Wire `pnpm test:run` into `.husky/pre-push` (after `pnpm build`)
- [x] Add a CI `test` job to `.github/workflows/ci.yml` (mirrors the `verify` setup block)
- [x] Isolate test types in `tsconfig.test.json` (4th project ref; `tsc -b` type-checks tests)
- [x] Seed coverage: `src/App.test.tsx` (RTL smoke) + `src/lib/app-config.test.ts` (unit)
- [x] **Follow-up (user/git):** add the **Test** check to `main`'s required branch-protection checks
      once it has run on a PR

**Why:** Previously there was no test runner, no `test` script, and no test files — `tsc -b &&
vite build` was the *only* automated safety net (type/bundle errors, nothing behavioral). Now Vitest
runs locally (watch/UI/coverage), on pre-push, and in CI as a distinct check.

### 2. Root error boundary ✅ DONE
- [x] Top-level React error boundary + fallback UI around `<App />` in `src/main.tsx`
      (`RootErrorBoundary` + `RootErrorFallback`, built on `react-error-boundary`)
- [x] Sentry-ready reporting seam `reportError()` (`src/lib/report-error.ts`) — every channel funnels through it
- [x] React 19 prod-only `createRoot` hooks (`onUncaughtError`/`onRecoverableError`) + global `window`
      `unhandledrejection`/`error` handlers for the async/uncaught errors a boundary can't catch
- [x] Test: `src/components/root-error-boundary.test.tsx` (throw → fallback → recover)
- [ ] **Deferred:** per-widget error boundaries (one bad widget shouldn't kill the page) — when widgets exist
- [ ] **Deferred:** swap `reportError` → Sentry (see #4)
- [ ] **Deferred:** route-level boundaries — when a router is added

**Architecture, decisions & roadmap:** [`docs/error-handling-architecture.md`](docs/error-handling-architecture.md).

**Why:** `main.tsx` mounted `<ThemeProvider><App/></ThemeProvider>` with no error boundary — any
render-time throw white-screened the whole app with no recovery. The boundary closes that for the React
tree, and the seam is the natural hook point for error reporting (#4). Note a boundary **can't** catch
async errors (the real order-book risk) — that hardening lives in the WS/data layer (see the doc's roadmap).

### 3. Security headers ✅ DONE
- [x] `public/_headers` (→ `dist/_headers`) sets the full set on the document + assets:
  `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` + CSP `frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy` (empty-allowlist `feature=()` syntax), HSTS (plain
  `max-age` — `.dev` is already preload-forced, so no `includeSubDomains`/`preload`)
- [x] `worker/config-response.ts` sets `nosniff` on `/config.js` — `_headers` can't reach
  Worker-generated responses (verified: `curl -I /config.js` shows nosniff but no CSP)
- [x] CSP keeps **both** `script-src` and `style-src` a clean `'self'` (verified against
  `public/_headers`/`dist/index.html`) — no `'unsafe-inline'` anywhere
- [x] Regression test (`worker/config-response.test.ts`) + worker-test wiring; verified live via
  `wrangler dev` + `curl`
- [ ] **Deferred:** per-env `connect-src` (exchange `wss://` origins) → move CSP into the Worker
      when endpoints diverge per env (a build-once `_headers` file is env-identical)
- [x] Dropped `style-src 'unsafe-inline'`: the theme-provider's runtime `<style>` injection became a
      bundled `.theme-transitions-off` class, so the CSP is now a strict `style-src 'self'`
- [ ] **Deferred:** deep-link/SPA-fallback header coverage once a router lands

**Architecture, decisions & roadmap:** [`docs/security-headers-setup.md`](docs/security-headers-setup.md).

**Why:** `worker/index.ts` served assets and `/config.js` but set **no security headers**. Given
the rest of the repo's security posture (secretlint, gitleaks, the "SPA ships everything to the
client" warning), this was a notable omission. CSP was very achievable since the only injected
script is the same-origin `/config.js`.

---

## Tier 2 — Production operations

### 4. Observability
- [x] Enable Workers logs: add `"observability": { "enabled": true }` to `wrangler.jsonc`
      (logs are **off by default**) — top-level block, verified inherited by all three envs
- [ ] Add client-side error tracking (e.g. Sentry) once there's real logic — pairs with the
      error boundary (#2); a one-line swap of the `reportError()` seam's body. See the Sentry adoption
      section of [`docs/error-handling-architecture.md`](docs/error-handling-architecture.md).

**Why:** There's currently no observability at all. Without it, prod failures are invisible.

### 5. Post-deploy smoke test
- [x] Add a `curl --fail` health check against each env URL after `wrangler deploy` in
      `.github/workflows/cd.yml` (verifies `/` **and** `/config.js`; `--retry-all-errors` for
      edge propagation) — runs in all three deploy jobs

**Why:** CD deploys all three envs but never verifies the deploy actually serves. A one-line check
catches a broken deploy before it's discovered manually — PROD especially.

### 6. Dependency automation ✅ DONE
- [x] Add `.github/dependabot.yml` (npm + github-actions ecosystems) — weekly, grouped non-majors,
      `chore(deps)`/`ci(deps)` prefixes, 7-day cooldown (both ecosystems), `versioning-strategy: increase`
- [x] Resolve the two gate collisions so Dependabot PRs stay green: relaxed commitlint
      `body-`/`footer-max-line-length` (required check) and guarded the CD `preview` job against
      `dependabot[bot]` (no Actions secrets on Dependabot runs)
- [x] Add an `ignore` rule pinning **`@types/node` to its 24.x major** (semver-major suppressed) so the
      types track the enforced Node 24 runtime — prompted by Dependabot PR #13 (24 → 26); see item #10
- [x] Resolve the sibling **`@cloudflare/workers-types` drift**: dropped the devDep and generate the Worker
      types from `compatibility_date` (`cf-typegen` → committed `worker/worker-configuration.d.ts`, CI-guarded
      by `cf-typegen:check`) — no ignore rule needed. See [`docs/cd-setup.md`](docs/cd-setup.md).
- [x] **Follow-up (user/GitHub):** enable Dependabot **alerts** + **security updates** in repo settings
      (`gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts` + `…/automated-security-fixes`)

**Architecture, decisions & roadmap:** [`docs/dependabot-setup.md`](docs/dependabot-setup.md).

**Why:** No Dependabot/Renovate config and no automated dependency updates. Fits the existing
CI/security posture cleanly.

---

## Tier 3 — Polish & hygiene

### 7. Branding / HTML metadata ✅ DONE
- [x] Replace the starter `vite.svg` favicon — `public/favicon.svg`, the Tabler **chart-histogram**
      glyph (white on the app's primary teal `#007595`), referenced with `sizes="any"`. **SVG-only**
      (not a full raster set — see deferred below)
- [x] Remove the leftover starter asset `src/assets/react.svg` (orphaned, zero references)
- [x] Add `<meta name="description">`, media-based light/dark `theme-color` (`#ffffff` / `#090b0c`
      from the `--background` OKLch tokens), and Open Graph + Twitter **text** tags to `index.html`
- [ ] **Deferred:** raster favicon set — `.ico` + 180×180 `apple-touch-icon` (iOS home-screen) +
      legacy fallback (SVG favicons degrade to *no* icon on browsers that don't support them)
- [ ] **Deferred:** `og:image` + `og:url` — needs a canonical domain (build-once bundle is
      env-identical, so no per-env URL) and a real 1200×630 share image; `twitter:card` currently
      degrades to a no-art `summary` card until then
- [ ] **Deferred:** sync `theme-color` to the app's manual `d`-key/`localStorage` theme override
      (media-based tags track the **OS** scheme only) — would wire `applyTheme()` in `theme-provider.tsx`

### 8. Onboarding templates ✅ DONE
- [x] Add `.env.example` — a documented **signpost**, not a var list: the app consumes **zero**
      build-time/client env vars (no `VITE_*`), so it explains that env-specific config is runtime
      via `/config.js` (`getConfig()` in `src/lib/app-config.ts`; dev via `vite.config.ts`, deployed
      via `wrangler.jsonc` `vars`) and points Worker secrets to `.dev.vars.example`
- [x] Add `.dev.vars.example` — documented placeholder for the **future** Worker-secrets path
      (copy → `.dev.vars` locally; `wrangler secret put <NAME> --env <env>` in deployed envs). No
      secrets exist today; the three Worker `vars` (`APP_ENV`/`API_BASE_URL`/`WS_URL`) are public
- [x] Add a `!.dev.vars.example` negation to `.gitignore` — the `.dev.vars.*` rule would otherwise
      ignore it (unlike `.env.example`, which was already allowlisted via `!.env.example`)

### 9. Minor ✅ DONE
- [x] Add a `LICENSE` — **proprietary / all rights reserved** (`Copyright (c) 2026 Timur Jalilov`);
      source is public for portfolio/demo only, not open-source. `package.json` `license` is
      `UNLICENSED` (npm's proprietary marker) + `author` metadata, with a matching README "License"
      section. (Was initially MIT; switched to all-rights-reserved to block reuse/commercialization
      while keeping the repo public.)
- [x] Add `.editorconfig` (Biome only covers `.ts`/`.tsx`; supplies charset/LF/final-newline/
      2-space-indent defaults for CSS/JSON/MD/YAML, mirroring the Biome formatter)
- [x] Add a PR template (`.github/PULL_REQUEST_TEMPLATE.md` — light checklist) + `CODEOWNERS`
      (`* @TimurJ`). **Follow-up (user/GitHub):** CODEOWNERS is inert until branch protection's
      *"Require review from Code Owners"* is enabled

### 10. Runtime & package-manager version lock ✅ DONE
- [x] Enforce the Node major, not just advise it: `engines.node: ">=24 <25"` in `package.json` +
      **`engineStrict: true`** in `pnpm-workspace.yaml` → `pnpm install` hard-fails on Node 22/26
      (verified empirically; `engines` alone only warns on pnpm 11, and `.npmrc` `engine-strict` is a
      no-op there). `.nvmrc` still selects which 24.x runs.
- [x] Pairs with the `@types/node` major-ignore in Dependabot (#6) — the types track the locked runtime
- [x] Lock the **package-manager** version too: `pmOnFail: download` (`pnpm-workspace.yaml`) makes pnpm
      self-manage from `package.json`'s `packageManager` field (dropped Corepack) — same determinism for
      pnpm as `engineStrict` gives for Node.

**Why:** `.nvmrc` was advisory (nvm-only); nothing stopped a contributor or CI from installing on a
different Node major. For a financial-app posture, the runtime must not silently drift across machines.

---

## Recommended order

1. **Tests** (Vitest + RTL + jsdom) — unblocks confident iteration on the real order-book code.
2. ~~**Error boundary**~~ (done) + **security headers** — small, close real production holes.
3. **Observability** + **smoke test** — quick wins, can land in the same pass.
4. Everything else as it becomes relevant.
