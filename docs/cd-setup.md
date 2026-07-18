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
| PROD trigger | **Tag `vX.Y.Z`** + required-reviewer gate + Environment tag policy | Auditable in git + a human stop; tag resolves to the pre-built artifact; a `v*.*.*` credential backstop to `classify` (§5) |
| UAT trigger | **Tag `vX.Y.Z-rc.N`** (trunk-based) | No long-lived release branches; semver-aligned; the `uat` Environment restricts deploys to `v*.*.*-rc.*` tags (§5) |
| Deploy tokens | **One per GitHub Environment** | Independently revocable; prod token only exposed to the gated prod job |
| Wrangler in CI | **`pnpm exec wrangler`** (pinned dep) | Mirrors `pnpm biome ci` over `setup-biome` — no version drift vs the lockfile |
| Deploy model | **Upload → smoke preview URL → promote to 100%** | Traffic is gated *behind* the smoke — a build that fails the smoke isn't promoted, so it serves no traffic (the live version keeps serving); replaces instant `wrangler deploy`. See §3.1. |
| Action pins | **Full commit SHA** (`@<sha> # vX.Y.Z`) | Immutable ref — a retagged/compromised action can't change what runs **with the deploy token**; Dependabot bumps the SHA + comment. See [`ci-setup.md`](ci-setup.md) §3.2. |
| Build provenance | **Attest on build (`actions/attest`), verify before promote** | Proves *which* build produced `dist-<sha>` (SLSA); every file promoted is provably from that build; attestation is out-of-band so build-once byte-identity holds. See §3.1. |

These forks were settled by discussion before any code, then stress-tested by feeding the plan
through a second reviewer twice (which caught two real bugs — see §4). The **Action pins** and
**Deploy model** rows came later — post-launch hardening steps (supply-chain and traffic-gating,
respectively), outside that original review.

---

## 3. What was built, file by file

- **`wrangler.jsonc`** — one config, three **named environments** (`[env.dev|uat|prod]`), each a
  separate Worker script (`crypto-order-book-{dev,uat,prod}`). Top-level `main`, `assets`,
  `compatibility_date`, and `observability` **inherit** to every env (only bindings/`vars` are
  non-inheritable, so `vars` is repeated per env). `assets`: `directory: ./dist`, `binding: ASSETS`,
  `not_found_handling: single-page-application`, `run_worker_first: ["/config.js"]`. **Workers Logs**
  are on via a single top-level `"observability": { "enabled": true }` (logs are **off by default**) —
  verified inherited by all three envs: a contrastive dry-run warns only that top-level `vars` "is not
  inherited", never `observability`.
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
- **`tsconfig.worker.json`** — type-checks `worker/` (no DOM lib) against runtime types generated into
  the committed `worker/worker-configuration.d.ts`; `types: []` additionally isolates it from every
  `@types/*`. Added to `tsconfig.json` `references` so `tsc -b` (and the pre-push
  hook) cover it. `vite build` does **not** bundle the Worker — **wrangler** does, at deploy time.
- **`worker/worker-configuration.d.ts`** — generated by `pnpm cf-typegen` (`wrangler types … --include-env
  false`) from `wrangler.jsonc`'s `compatibility_date` and **committed**. It replaced the static
  `@cloudflare/workers-types` devDep, whose `4.YYYYMMDD.x` date drifted ahead of the pinned
  `compatibility_date` (Dependabot treated the date as a *minor*, so a semver-major ignore couldn't hold
  it). Generated types are a projection of `compatibility_date`, so they can't outrun the runtime.
  Regenerate + commit after changing `compatibility_date` or bumping `wrangler`/`workerd`; CI's
  `cf-typegen:check` (`… --check`, in the `verify` job) fails when the committed file is stale.
  Biome-ignored via `!worker/worker-configuration.d.ts`; `--include-env false` keeps the output
  deterministic (no `interface Env` collision with the hand-written `Env`, no local paths).
- **`package.json`** — devDeps `wrangler` (no `@cloudflare/workers-types` — see above); scripts
  `deploy:dev|uat|prod` (`wrangler deploy --env <name>`) + `cf-typegen` / `cf-typegen:check`.
- **`pnpm-workspace.yaml`** — `allowBuilds: { workerd: true, sharp: false }` (see §4).
- **`.github/workflows/cd.yml`** — the pipeline (see §3.1).
- **`.gitignore`** — `.dev.vars*`, `.wrangler`.

### 3.1 The CD workflow (`cd.yml`)

| Job | Trigger | What it does |
|---|---|---|
| `classify` | tag push | regex the tag → `channel` (`prod` `vX.Y.Z` / `uat` `…-rc.N` / `none`), and **reject a non-increasing version** vs the latest release tag |
| `build` | **push to `main` only** | `pnpm build` → **attest SLSA provenance** → upload artifact `dist-<sha>` (90-day retention) |
| `preview` | PR (same-repo) | `wrangler versions upload --env dev` → comment the preview URL |
| `deploy-dev` | push to `main` | download same-run artifact → `versions upload` → **smoke the preview URL** → `versions deploy @100` → confirm live |
| `deploy-uat` | `needs: classify`, channel `uat` | cross-run download `dist-<sha>` → `versions upload` → **smoke preview** → `versions deploy @100` → confirm live |
| `deploy-prod` | `needs: classify`, channel `prod` | gated on prod reviewer → cross-run download → `versions upload` → **smoke preview** → `versions deploy @100` → confirm live |

**Build-once linchpin:** `build` runs *only* on the `main` merge, producing exactly one `dist-<sha>`.
Tag deploys never rebuild — they resolve the main-build run for the tag's SHA
(`gh run list --workflow cd.yml --commit <sha> --branch main`, fail loudly on ≠1 match) and
`actions/download-artifact` it cross-run. Only `deploy-dev` shares a run with `build`.

**Environment tag policies:** the `prod`/`uat` Environments additionally restrict deploys to `v*.*.*`
/ `v*.*.*-rc.*` tags — a credential backstop to `classify`. Setup + rationale in §5.

**Build provenance (SLSA):** right after `pnpm build`, the `build` job attests the bundle with
`actions/attest` (`subject-path: dist/**/*`) — a Sigstore-signed SLSA build-provenance record of which
workflow + commit produced those exact bytes, minted via the job's `id-token: write` /
`attestations: write` and stored out-of-band (so `dist/` bytes are untouched and build-once holds).
Each deploy job then **verifies before promoting**: after downloading `dist-<sha>` it runs
`scripts/verify-attestation.sh dist "$GITHUB_REPOSITORY"` (loops every file through `gh attestation
verify` — pinned via `--signer-workflow` to the `cd.yml` build job, so only *that* workflow's
attestation counts — with a short retry for same-run propagation), so every file that
reaches an env is provably from the build. Free on this public repo — no setting, the `attestations: write` token
scope enables minting and deploys read with `attestations: read`. `actions/attest` (bare, subject-path
only) defaults to build provenance; one verify script, three call sites, auto-linted by CI's `shell`
job.

**Pre-promote smoke (traffic gated behind it):** instead of an instant `wrangler deploy`, each deploy
job **uploads a new version** (`wrangler versions upload`, which routes *no* traffic), runs
`scripts/smoke.sh` against that version's **preview URL**, and only then **promotes** it to 100%
(`wrangler versions deploy <id>@100 --yes`). A build that fails the smoke is never promoted — the
previous version keeps serving. The smoke goes past a `200`: on the document (`/`) it asserts the
`public/_headers` security headers (CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, HSTS) and a stable SPA shell marker (`<title>Crypto Order Book</title>`), and on
the Worker-generated `/config.js` (a different code path than the static assets) it asserts `nosniff`
and `"env":"<env>"` — proving the *right* environment's config is live. It does **not** echo the exact
Cloudflare version id from the response (that would need a `version_metadata` binding — a possible
future enhancement, e.g. a Sentry release tag); but the pre-promote smoke targets the
*version-specific* preview URL (whose hostname *is* the uploaded version id), so it's inherently
version-targeted. A final run of the same script against the live URL confirms the cutover.
`--retry 3 --retry-delay 3 --retry-all-errors` absorbs the few-second edge propagation; no secrets
needed (public URLs). One script, six call sites (preview + live × three envs), auto-linted by CI's
`shell` job (`scripts/*.sh`).

This placement was the point of the change. The earlier smoke ran *after* `wrangler deploy` — not a
deliberate "test after live is fine" call, but the only option that primitive allowed (an instant
cutover has no staged, not-yet-live state to test). The upload-then-promote flow (once deferred in §8
as brittle) gives us that staged state, so the smoke now gates traffic rather than merely reporting on
it. It still automates the manual check in §6 step 2, now *before* users are exposed.

**Inert until configured:** deploy/preview jobs gate on `vars.CLOUDFLARE_ACCOUNT_ID != ''`, so the
workflow no-ops (green, no red X) until credentials exist — the smoke test rides inside those guarded
jobs, so it first runs on the next `main` merge once creds are set.

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

9. **Wiring `versions upload` + `versions deploy` in CI has four sharp edges** (from moving the deploy
   jobs to the pre-promote gate, §3.1):
   - `versions deploy` is **interactive by default** — CI must pass `--yes` *and* an explicit
     `<version-id>@100` spec (a bare invocation prompts for versions/percentages).
   - **Capture the version id from `versions upload` output** (it has no `--json`): grep a
     label-agnostic UUID (`[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}`), so an output-wording change
     doesn't silently break it, and **fail loud** on an empty id/URL rather than promoting a blank.
   - GitHub Actions already runs `run:` steps under **`bash -eo pipefail`**, so a `wrangler … | tee`
     failure propagates on its own (no manual `set -o pipefail` needed) — but that same default
     `errexit` means the capture must use `grep -m1 … || true`, or a no-match (or a `head` SIGPIPE)
     aborts the step before the guard can print a useful error.
   - **Version Preview URLs must be enabled per env.** Only DEV's is proven (via the `preview` job);
     UAT/PROD have `workers_dev` but *version* preview URLs are a separate toggle. If the URL guard
     trips on a first run, enable Preview URLs for that Worker (dashboard / `"preview_urls": true`) or
     add `--preview-alias`.

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

**Environment tag policies (prod + uat).** Beyond the reviewer gate, restrict *which refs* may
deploy to each gated env — a credential-layer backstop to the `classify` job, so the prod/uat tokens
can only be exercised by correctly-shaped release tags. GitHub's deployment-branch-policy (with
`type: tag`, Ruby `File.fnmatch` patterns) does this, set from the Environment's settings page:

Settings → Environments → **prod** → set **Deployment branches and tags** to **Selected branches and
tags** → **Add deployment branch or tag rule** → **Ref type** = **Tag**, **Name pattern** = `v*.*.*`
→ **Add rule**. Repeat on **uat** with `v*.*.*-rc.*`. (Required reviewers and the wait timer live on
the same page.) Verify by confirming the rule now shows under *Deployment branches and tags*.

Notes: `v*.*.*` also matches `…-rc.N` (a `*` glob can't exclude the suffix) — harmless, since
`classify`'s `^v[0-9]+\.[0-9]+\.[0-9]+$` regex is the precise prod gate and the policy is only the
coarse credential backstop. **`dev` is deliberately left open** — its Environment is shared by the PR
`preview` job, so a branch/tag restriction there would block previews. **Wait timer:** intentionally
none (the reviewer gate is the human stop for a solo maintainer); enable one on the same settings page
if a change-window buffer is ever wanted.

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

**Release flow** (the day-to-day — also in the README). Use **`pnpm release`**
(`scripts/release-tag.sh`) rather than hand-tagging — you choose the bump, it does the version math,
preflight, and push:
```bash
# 1) Land work on main (PR → CI → merge). The main build auto-deploys DEV.
# 2) UAT — cut a candidate (rc.N auto-increments off the latest release):
pnpm release patch rc     # e.g. v0.1.1-rc.1  → UAT
# 3) PROD — after UAT looks good. Pins to the tested rc's commit; the run waits for approval:
pnpm release patch        # → v0.1.1          → PROD (approval-gated)
#    Approve in: Actions → the run → "Review deployments" → prod → Approve.
```
`patch|minor|major` is your explicit choice (never derived from commits); `--dry-run` previews,
`--yes` skips the prompt. The script computes the next version off the latest release tag (the same
baseline the monotonic gate uses, so it never collides or regresses), and a **final release pins to
the exact commit the tested `rc` points to** (build-once-promote — PROD ships what UAT ran) plus
attaches auto-generated `gh` release notes (best-effort). It pushes plain git tags, so the triggers
below are unchanged.

A final release **requires its `-rc.*` to be on `origin`** (proof it deployed to UAT) — the preflight
hard-blocks a missing or local-only candidate rather than silently promoting UAT-untested bytes. The
`--allow-no-rc` flag is the explicit escape hatch to tag `main` HEAD straight to PROD; `--yes` alone
can't satisfy it, so unattended automation can't skip UAT by accident.

The script's version math carries three portability/robustness gotchas worth keeping on a replay
(from #23/#24):

- **`sort -V` is GNU-only** — it silently misbehaves on a stock Mac's BSD `sort`, so the "latest
  release" computation uses a portable numeric field sort instead:
  `sort -t. -k1.2,1n -k2,2n -k3,3n` (`-k1.2` starts field 1 at character 2, skipping the leading
  `v`). CI's `shell` job guards syntax and shellcheck findings, **not** GNU-only flags — those stay
  a review concern. (Forensics aside: `git log -S 'sort -V'` never flags the fix commit — its
  comment mentions the string, so the occurrence count is unchanged.)
- **Version segments are normalized with `$((10#$n))`** before arithmetic — without the base-10
  prefix, a leading-zero segment (a hand-made `v0.08.0`) is read as **octal**, and `08`/`09` are
  hard errors inside `$((…))`.
- **A failed `git push` deletes the just-created local tag** (`git tag -d`) — an orphaned local tag
  would otherwise skew the next run's "latest release" baseline and block re-tagging.

> **Why a helper, not release-please:** we evaluated release-please and kept the explicit tag model —
> for a private (unpublished) financial app its value-adds don't apply, it's weak on the
> prerelease/UAT-signoff flow, and it would need a prod-triggering write-scoped PAT. The helper is
> just the version math + preflight; the pipeline stays tag-driven.

> **Ordering rule:** a tag only deploys a commit that has **landed on `main` and finished its
> `build`** — the only thing that produced a `dist-<sha>` to promote. The `pnpm release` preflight
> checks this locally; tagging anything else still fails the deploy loudly (by design) server-side.

**Local:** `pnpm deploy:dev|uat|prod` deploy by hand; `wrangler dev` runs the Worker + SPA locally.

**Rollback (runbook).** Every **upload** records a Worker version (the promote only shifts traffic to
it), so a known-good version is always one command away. Rollback is **manual by design** — the
pre-promote smoke already blocks a build that fails to serve *before* any traffic, so this is for
issues that surface *after* promote (a runtime error, bad config, a regression), not for a failed
deploy.

1. **Primary path (known-good).** Find a good version, then re-promote it — this is exactly the
   command CD's promote step runs:
   ```bash
   pnpm exec wrangler versions list --env prod          # or: --name crypto-order-book-prod
   pnpm exec wrangler versions deploy <version-id>@100 --env prod --yes
   ```
2. **Shortcut.** `wrangler rollback` re-deploys a prior version in one step (no id ⇒ the version
   *before* the latest; `--message` skips the interactive confirm). It targets the worker via
   **`--name`, not `--env`**:
   ```bash
   pnpm exec wrangler rollback [<version-id>] --name crypto-order-book-prod --message "reason"
   ```
3. **Re-tag path.** Re-run the deploy for a previous good tag/commit — build-once means it reuses
   that commit's `dist-<sha>` (no rebuild).
4. **Verify** the cutover: `bash scripts/smoke.sh https://crypto-order-book-prod.timurjalilov1.workers.dev prod`.

Swap `prod`/`crypto-order-book-prod` for uat/dev to roll those back. Auth locally via `wrangler login`
or a `CLOUDFLARE_API_TOKEN` with `Workers Scripts:Edit`.

**Branch protection:** `main` is Strict-protected (PR + the required CI checks must pass, branch up
to date, enforced on admins). The CD checks are intentionally *not* required (they skip on PRs or
depend on Cloudflare).

---

## 8. Deferred / future

Documented as deliberate non-goals for v1; each slots into what exists:

- **R2-keyed artifacts** for retention beyond GitHub's 90 days.
- **Offline provenance verification** — deploys verify via the GitHub API (`gh attestation verify --repo`); plumbing the attest step's `bundle-path` through the artifact would enable offline `--bundle` verification (no API dependency). Deferred — the online path + retry suffices.
- **Gradual/canary PROD rollout** — the upload-then-promote **mechanism is now wired** (§3.1): the two
  blockers once cited here (interactive `versions deploy`, no version-id to capture) are resolved via
  `--yes` + a grepped version id. What remains deferred is the *percentage split* itself
  (`versions deploy <new>@10 <old>@90` → observe → `@100`), which also needs the current live version id
  (`wrangler deployments status --json`) and, to be meaningful, error-rate gating. Kept out for
  simplicity until real traffic warrants it.
- **Custom domains** (replace the `workers.dev` URLs).
- **HTMLRewriter SPA-shell** config variant (stream config into `index.html`, no extra round-trip).
- **Vitest CD job** — a deliberate non-goal. CI already runs the suite on every PR and push to
  `main`; build-once-promote then ships that same `dist-<sha>` through UAT/PROD unchanged, so
  re-running unit tests at promote time tests nothing the CI run didn't. Deploy-time verification is
  `smoke.sh` — a different kind of check.
- **Backend:** API routes via `run_worker_first: ["/api/*"]`, a Durable Object class for WS fan-out,
  or a Container for Python — each just adds bindings to the dev/uat/prod blocks already in
  `wrangler.jsonc`. **Caveat for that work:** the deploy jobs now use `versions upload`/`versions
  deploy`, which **cannot apply Durable Object migrations** (migrations are atomic — Cloudflare
  requires a plain `wrangler deploy`). A release that introduces or changes a DO migration will need a
  `wrangler deploy` path rather than the upload→smoke→promote gate.
