# Continuous Delivery setup — Cloudflare Workers

A step-by-step record of how the three-environment CD pipeline was designed, built, and shipped —
including the gotchas hit along the way and how each was resolved — plus a runbook for operating it.

> **Status:** live since **2026-06-27**. DEV/UAT/PROD all deploy to Cloudflare Workers and
> build-once-promote is verified (identical hashed bundle across all three envs).
>
> This is the long-form history. The short versions live in [`README.md`](../README.md#deployment-cloudflare-workers)
> (how-to) and [`CLAUDE.md`](../CLAUDE.md#cd--cloudflare-workers) (rationale). Update those on changes;
> update this file when the *setup itself* meaningfully changes.

---

## 1. Goals & why these choices

This is a **full-stack learning project**. The CD setup was built to learn real promotion mechanics
now, and to be the skeleton a Node/Python backend slots into later.

- **Three environments (DEV / UAT / PROD).** Chosen deliberately to learn CD, even though for a
  static SPA *today* they're ~90% ceremony (same bytes, only runtime config differs, no real "UAT
  actor"). The value is the pipeline plumbing + the fact the backend will make the envs genuinely
  distinct.
- **Cloudflare Workers** over Vercel/AWS, because the future backend maps onto CF primitives:
  - multi-dealer WebSocket fan-out → **Durable Objects** (one stateful object per session/venue);
  - long-running Python order processing → **Containers** (GA Apr 2026);
  - API routes → the **same Worker**.
  - We hand-roll CD in GitHub Actions on purpose (to learn it), which neutralizes Vercel's main
    edge (its git-deploy magic). AWS's ops overhead (IAM/VPC/ALB/Fargate) isn't worth it yet.
- **Workers Static Assets**, not Pages — Cloudflare's recommended path for new SPAs; assets + Worker
  deploy as one unit, and the Worker is the seam for `/config.js` (and later `/api/*`).

---

## 2. Architecture decisions (the locked forks)

| Decision | Choice | Why |
|---|---|---|
| Artifact strategy | **Build once, promote the same bytes** | PROD ships exactly what UAT signed off; no rebuild drift |
| Env config | **Runtime, via `/config.js`** (not `VITE_*`) | `VITE_*` bakes at build time → would need a build per env, breaking build-once |
| PROD trigger | **Tag `vX.Y.Z`** + required-reviewer gate | Auditable in git + a human stop; tag resolves to the pre-built artifact |
| UAT trigger | **Tag `vX.Y.Z-rc.N`** (trunk-based) | No long-lived release branches; semver-aligned |
| Deploy tokens | **One per GitHub Environment** | Independently revocable; prod token only exposed to the gated prod job |
| Wrangler in CI | **`pnpm exec wrangler`** (pinned dep) | Mirrors `pnpm biome ci` over `setup-biome` — no version drift vs the lockfile |

These were settled by discussion before any code, then stress-tested by feeding the plan through a
second reviewer twice (which caught two real bugs — see §4).

---

## 3. What was built, file by file

- **`wrangler.jsonc`** — one config, three **named environments** (`[env.dev|uat|prod]`), each a
  separate Worker script (`crypto-order-book-{dev,uat,prod}`). Top-level `main`, `assets`, and
  `compatibility_date` **inherit** to every env (only bindings/`vars` are non-inheritable, so `vars`
  is repeated per env). `assets`: `directory: ./dist`, `binding: ASSETS`,
  `not_found_handling: single-page-application`, `run_worker_first: ["/config.js"]`.
- **`worker/index.ts`** — a thin Worker. For `/config.js` it returns JS setting
  `window.__APP_CONFIG__` from the env's `vars`, with `Cache-Control: no-store`. Everything else
  falls through to `env.ASSETS.fetch(request)` (SPA fallback to `index.html`). Future API/DO/Container
  routes branch here. Uses `export default { fetch }` (a Worker requirement).
- **Runtime config plumbing:**
  - `vite.config.ts` → a `runtimeConfig` plugin that (a) injects `<script src="/config.js">` into
    `index.html` via `transformIndexHtml` (so it's never bundled), and (b) serves `/config.js` with
    local defaults in `pnpm dev` via `configureServer`.
  - `src/lib/app-config.ts` → typed `getConfig()` / `AppConfig` + the `window.__APP_CONFIG__`
    global declaration. The app reads config only from here.
- **`tsconfig.worker.json`** — type-checks `worker/` with `@cloudflare/workers-types` (no DOM lib),
  added to `tsconfig.json` `references` so `tsc -b` (and the pre-push hook) cover it. `vite build`
  does **not** bundle the Worker — **wrangler** does, at deploy time.
- **`package.json`** — devDeps `wrangler` + `@cloudflare/workers-types`; scripts `deploy:dev|uat|prod`
  (`wrangler deploy --env <name>`) + `cf-typegen` (`wrangler types`).
- **`pnpm-workspace.yaml`** — `allowBuilds: { workerd: true, sharp: false }` (see §4).
- **`.github/workflows/cd.yml`** — the pipeline (see §3.1).
- **`.gitignore`** — `.dev.vars*`, `.wrangler`.

### 3.1 The CD workflow (`cd.yml`)

| Job | Trigger | What it does |
|---|---|---|
| `classify` | tag push | regex the tag → `channel` (`prod` `vX.Y.Z` / `uat` `…-rc.N` / `none`), and **reject a non-increasing version** vs the latest release tag |
| `build` | **push to `main` only** | `pnpm build` → upload artifact `dist-<sha>` (90-day retention) |
| `preview` | PR (same-repo) | `wrangler versions upload --env dev` → comment the preview URL |
| `deploy-dev` | push to `main` | download same-run artifact → `wrangler deploy --env dev` |
| `deploy-uat` | `needs: classify`, channel `uat` | cross-run download `dist-<sha>` → `wrangler deploy --env uat` |
| `deploy-prod` | `needs: classify`, channel `prod` | gated on prod reviewer → cross-run download → `wrangler deploy --env prod` |

**Build-once linchpin:** `build` runs *only* on the `main` merge, producing exactly one `dist-<sha>`.
Tag deploys never rebuild — they resolve the main-build run for the tag's SHA
(`gh run list --workflow cd.yml --commit <sha> --branch main`, fail loudly on ≠1 match) and
`actions/download-artifact` it cross-run. Only `deploy-dev` shares a run with `build`.

**Inert until configured:** deploy/preview jobs gate on `vars.CLOUDFLARE_ACCOUNT_ID != ''`, so the
workflow no-ops (green, no red X) until credentials exist.

---

## 4. Gotchas hit & how they were fixed

The brittle part. Each is symptom → cause → fix.

1. **Every `pnpm <script>` suddenly failed with `ERR_PNPM_IGNORED_BUILDS`.**
   *Cause:* adding `wrangler` pulled in native build scripts (`workerd`, and `sharp` via miniflare);
   pnpm 11 blocks unapproved build scripts and its pre-run deps check turns unresolved ones into a
   hard failure — which broke `build`, `biome`, and would break CI + the pre-push hook.
   *Fix:* resolve them in `pnpm-workspace.yaml` → `allowBuilds: { workerd: true, sharp: false }`
   (`workerd` = CF runtime for local `wrangler dev`; `sharp` = image emulation we don't use). Never
   leave the `set this to true or false` placeholder pnpm writes.

2. **`vite build` warned: "`<script src="/config.js">` can't be bundled without `type=module`".**
   *Cause:* a hardcoded `<script>` in `index.html` made Vite try to resolve/bundle a file that only
   exists at runtime.
   *Fix:* don't hardcode it — inject the tag from the `runtimeConfig` plugin via `transformIndexHtml`
   (`injectTo: "head-prepend"`). Injected tags aren't bundled; the warning disappears and the tag
   lives in one place.

3. **The plan would have silently broken build-once** (caught in adversarial review).
   *Cause:* an early draft had `build` trigger on tags *and* a cross-run artifact resolver. On a tag
   that rebuilds the SHA (breaking "promote the same bytes") and creates a *second* artifact-producing
   run per SHA — tripping the resolver's "exactly one run" invariant.
   *Fix:* `build` is **main-only** (`if: push && ref == refs/heads/main`); `deploy-uat`/`deploy-prod`
   depend on `classify` only (not `build`, which is skipped on tags) and download cross-run.

4. **Reviewer suggested pinning `cloudflare/wrangler-action`'s version.**
   *Cause:* the action installs its own wrangler, which can drift from the lockfile-pinned devDep.
   *Fix:* drop the action entirely; use `pnpm exec wrangler` — same reasoning the repo already
   applied choosing `pnpm biome ci` over `biomejs/setup-biome`.

5. **`compatibility_date` was a year stale** (`2025-06-01`). *Fix:* set near today (`2026-06-01`);
   the nav-prefers-asset-serving behaviour only needs `≥ 2025-04-01`.

6. **Creating the CF API token forced a "Choose a Zone resource" with an empty/disabled dropdown.**
   *Cause:* the "Edit Cloudflare Workers" template bundles a **zone-scoped** `Workers Routes: Edit`
   permission (for custom-domain routes), but we're on `workers.dev` with no zones.
   *Fix:* in the token's **Permissions**, delete the `Zone → Workers Routes` row — the Zone Resources
   requirement vanishes; keep Account Resources = your account. (Alternative: set Zone Resources to
   "All zones", but removing the permission is tighter.)

7. **Token blast-radius isn't what it looks like.** Cloudflare's `Workers Scripts: Edit` is
   **account-wide** — a standard token can't be scoped to one Worker script. The real wins are
   *independently revocable* per-env tokens + the prod token gated behind the prod approval. True
   per-resource isolation would need separate CF accounts per env (overkill here).

8. **First PR preview on a brand-new Worker** was expected to be rough (`versions upload` before any
   deploy exists), so the plan was to seed via the `main`→DEV deploy first. In practice the PR
   preview ran fine, so it was a non-issue — but the "merge to main first" ordering is still the
   clean bootstrap.

---

## 5. Manual setup (Part B) — exact steps

Only a human can do these (create the CF account/tokens). The pipeline is inert until done.

### Cloudflare
1. **Account ID** — dashboard → Compute (Workers) → right sidebar (also the hex in the dashboard URL).
   Here: `f10fb4dea47627cf7dea6f68bface9d1`.
2. **`workers.dev` subdomain** — Compute (Workers) → Subdomain. Here: `timurjalilov1` (the label
   before `.workers.dev`). Register one if you never have.
3. **Three API tokens** — Profile → API Tokens → Create Token → **"Edit Cloudflare Workers"** template
   → **delete the `Zone → Workers Routes` permission row** (gotcha #6) → Account Resources = your
   account → name them `Crypto Order Book CD - {DEV,UAT,PROD}` → create → copy each (shown once).

### GitHub (run from the repo with `gh`)
```bash
# Repo variables (not secret) — also the deploy on-switch
gh variable set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
gh variable set WORKERS_SUBDOMAIN     --body "<subdomain-label>"

# Environments (prod = you as required reviewer; self-review left ON since you're solo)
gh api -X PUT repos/{owner}/{repo}/environments/dev
gh api -X PUT repos/{owner}/{repo}/environments/uat
gh api -X PUT repos/{owner}/{repo}/environments/prod --input - <<EOF
{"reviewers":[{"type":"User","id":$(gh api user --jq .id)}]}
EOF

# Per-environment deploy tokens (paste each token at the prompt — keeps them out of shell history)
gh secret set CLOUDFLARE_API_TOKEN --env dev
gh secret set CLOUDFLARE_API_TOKEN --env uat
gh secret set CLOUDFLARE_API_TOKEN --env prod
```

---

## 6. First run & validation (what "done" looked like)

1. **Local:** `pnpm build` (typechecks the Worker too via the project ref), `pnpm biome ci`, and
   `pnpm exec wrangler deploy --env {dev,uat,prod} --dry-run` — the dry-runs resolved each env's
   `APP_ENV` + `ASSETS` binding, empirically confirming top-level `assets`/`main` inherit per env.
2. **Merge to `main`** → `build` produced `dist-<sha>`, `deploy-dev` created the DEV Worker. Verified
   live: `GET /` → 200; `GET /config.js` → `application/javascript`, `cache-control: no-store`, body
   `…"env":"dev"…`; `GET /book/BTC-USD` → `200 text/html` (SPA fallback).
3. **Tag `v0.1.0-rc.1`** → UAT deployed the same artifact.
4. **Tag `v0.1.0`** → PROD job waited on approval → approved → deployed.
5. **Build-once proof** — the hashed bundle is identical across all three:
   ```
   dev  : /assets/index-CDVGuCDD.js
   uat  : /assets/index-CDVGuCDD.js
   prod : /assets/index-CDVGuCDD.js
   ```

---

## 7. Operating it

**Live URLs:** `https://crypto-order-book-{dev,uat,prod}.timurjalilov1.workers.dev`

**Release flow** (the day-to-day — also in the README):
```bash
# 1) Land work on main (PR → CI → merge). The main build auto-deploys DEV.
# 2) UAT — tag the merged commit:
git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1
# 3) PROD — after UAT looks good. The run waits for approval:
git tag v0.1.0 && git push origin v0.1.0
#    Approve in: Actions → the run → "Review deployments" → prod → Approve.
```
> **Ordering rule:** only tag a commit that has **landed on `main` and finished its `build`** — that's
> the only thing that produced a `dist-<sha>` for tag deploys to promote. Tagging anything else fails
> the deploy loudly (by design) rather than silently rebuilding.

**Local:** `pnpm deploy:dev|uat|prod` deploy by hand; `wrangler dev` runs the Worker + SPA locally.

**Rollback:** every `wrangler deploy` records a Worker version, so roll back with `wrangler rollback`
(per env) or by re-running the deploy for a previous tag/commit's artifact.

**Branch protection:** `main` is Strict-protected (PR required, the 3 CI checks must pass, branch up
to date, enforced on admins). The CD checks are intentionally *not* required (they skip on PRs or
depend on Cloudflare).

---

## 8. Deferred / future

Documented as deliberate non-goals for v1; each slots into what exists:

- **R2-keyed artifacts** for retention beyond GitHub's 90 days.
- **Gradual/canary PROD rollout** — `wrangler versions upload` + `wrangler versions deploy <id>@<pct> --yes`
  (deferred because `versions deploy` is interactive and `versions upload` has no version-id JSON to
  capture — brittle to wire robustly).
- **Custom domains** (replace the `workers.dev` URLs).
- **HTMLRewriter SPA-shell** config variant (stream config into `index.html`, no extra round-trip).
- **Vitest CD job** when tests land.
- **Backend:** API routes via `run_worker_first: ["/api/*"]`, a Durable Object class for WS fan-out,
  or a Container for Python — each just adds bindings to the dev/uat/prod blocks already in
  `wrangler.jsonc`.
