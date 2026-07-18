# Testing setup — Vitest + React Testing Library

A step-by-step record of how the test harness was added, the decisions behind it, the gotchas hit
along the way, and a from-scratch recipe to reproduce it on the next project.

> **Status:** live since **2026-06-28**. 94 tests green across 16 files; wired into the pre-push hook
> and a dedicated CI `test` job. Type-checked as part of `pnpm build`. Shared doubles live in
> `src/test/` (`fake-web-socket.ts` and `silence-console-error.ts` serve both connection-stack suites).
>
> This is the long-form history. The short versions live in
> [`README.md`](../README.md#testing) (how-to) and [`CLAUDE.md`](../CLAUDE.md#testing--vitest)
> (rationale/conventions). Update those on changes; update this file when the *setup itself* changes.

---

## 1. Goals & why these choices

Before this, the only automated gate was `tsc -b && vite build` — it catches type and bundle errors
but **nothing behavioral**. The harness adds a real test gate so order-book feature work can land with
confidence, and it plugs into the gates that already exist (pre-push + CI).

- **Vitest** over Jest. Vitest reuses the project's **Vite** transform pipeline and config (plugins,
  the `@`→`src` alias, esbuild for TS/JSX) — so there's no second toolchain (no Babel, no `ts-jest`)
  to keep in sync with the app. It's the native choice for a Vite app and is API-compatible with Jest.
- **React Testing Library (RTL)**. Tests behavior through the accessibility tree (roles/text), not
  component internals — resilient to refactors. Paired with **`@testing-library/jest-dom`** for
  readable DOM matchers (`toBeInTheDocument`, …) and **`@testing-library/user-event`** for realistic
  interaction.
- **jsdom** over happy-dom. More complete browser-API emulation (the RTL/Vitest default); speed is a
  non-issue at this scale. happy-dom is the faster-but-thinner alternative if it ever matters.

---

## 2. Architecture decisions (the locked forks)

| Decision | Choice | Why |
|---|---|---|
| Config location | **Separate `vitest.config.ts`** that `mergeConfig`s `vite.config.ts` | Keeps the build config free of test concerns; tests still inherit the `@` alias + `react()`/`tailwindcss()` plugins (no duplication) |
| DOM environment | **jsdom** | Most complete emulation; RTL's default |
| Test globals | **`globals: true`** | Exposes `describe`/`it`/`expect` without imports **and** gives RTL the global `afterEach` it hooks into for automatic DOM cleanup |
| Type isolation | **Dedicated `tsconfig.test.json`** (4th project ref) | Confines `vitest/globals` + jest-dom matcher types to tests — mirrors how `tsconfig.worker.json` isolates the Worker |
| Type gate | **Test project in root `references`** → `tsc -b` checks tests | One unified type gate; consistent with the build already type-checking the non-shippable `vite.config.ts`. Tradeoff: a test-only type error fails the build (acceptable under strict branch protection) |
| Version pinning | **Exact-pin the `@vitest/*` trio** (`vitest`, `coverage-v8`, `ui`) | They peer-depend on each other at the exact version; pinning matches the repo's exact-pinned Biome and removes desync risk |

These were settled before coding, then stress-tested by feeding the plan through an external
adversarial review — which flagged two real things to verify: that `vite.config.ts` is object-form
(so `mergeConfig` is safe), and that the unified type-gate fork was a deliberate choice (it is).

---

## 3. What was built, file by file

**New files**

- **`vitest.config.ts`** — `mergeConfig(viteConfig, defineConfig({ test: … }))` importing from
  `vitest/config`. Test block: `environment: "jsdom"`, `globals: true`,
  `setupFiles: ["./src/test/setup.ts"]`,
  `include: ["src/**/*.{test,spec}.{ts,tsx}", "worker/**/*.{test,spec}.ts"]`. (Vitest's
  globber **does** support `{…}` braces — unlike tsconfig; see §4.1.)
- **`src/test/setup.ts`** — registers the jest-dom matchers on Vitest's `expect`
  (`import "@testing-library/jest-dom/vitest"`) and stubs `window.matchMedia` (jsdom omits it; the
  `ThemeProvider` `system`-theme path reads it). Runs before every test file.
- **`tsconfig.test.json`** — isolated project mirroring `tsconfig.app.json` but with
  `types: ["vitest/globals", "@testing-library/jest-dom", "vite/client"]` and `lib: ["ES2023", "DOM"]`,
  `jsx: "react-jsx"`. `include` enumerates the test globs + `src/test` + `worker/**/*.test.ts` (no
  braces — see §4.1), so Worker-side tests type-check here with the test toolchain;
  `tsconfig.worker.json` correspondingly **excludes** `worker/**/*.test.ts` so no file is claimed by
  two projects.
- **`src/App.test.tsx`** — RTL smoke test: `render(<App />)`, assert the heading, the button, and the
  `env: local` fallback render.
- **`src/lib/app-config.test.ts`** — unit test of `getConfig()`'s fallback vs injected-config paths.

**Edited files**

- **`tsconfig.json`** — added `{ "path": "./tsconfig.test.json" }` to `references` (4th project).
- **`tsconfig.app.json`** — added `exclude` for the test globs + `src/test`, so each file lives in
  exactly one project for `tsc -b`.
- **`package.json`** — 4 scripts + 8 devDeps (§3.1).
- **`.husky/pre-push`** — now `pnpm build` **then** `pnpm test:run`.
- **`.github/workflows/ci.yml`** — added a `test` job (same setup block as `verify`, runs
  `pnpm test:run`).
- **`.gitignore`** — added `coverage` (written by `test:coverage`).

### 3.1 Scripts & dependencies

**Scripts** (`package.json`):

| Script | Command | Use |
|---|---|---|
| `test` | `vitest` | Watch mode (dev) |
| `test:run` | `vitest run` | One-shot — CI + pre-push |
| `test:ui` | `vitest --ui` | Browser dashboard |
| `test:coverage` | `vitest run --coverage` | v8 coverage report |

**devDependencies** — versions verified against the **live npm registry** on 2026-06-28:

| Package | Version | Notes |
|---|---|---|
| `vitest` | `4.1.9` (exact) | peer `vite: ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0` → supports the repo's Vite 8; `engines.node ^20 \|\| ^22 \|\| >=24` — a superset of the repo's own `engines.node >=24 <25` lock, so `engineStrict` never trips on it |
| `@vitest/coverage-v8` | `4.1.9` (exact) | must equal the `vitest` version |
| `@vitest/ui` | `4.1.9` (exact) | must equal the `vitest` version |
| `@testing-library/react` | `16.3.2` | peer `react ^18 \|\| ^19`; needs `@testing-library/dom ^10` as an explicit peer under pnpm |
| `@testing-library/dom` | `10.4.1` | peer of RTL |
| `@testing-library/jest-dom` | `6.9.1` | custom DOM matchers |
| `@testing-library/user-event` | `14.6.1` | realistic interactions |
| `jsdom` | `29.1.1` | DOM environment (declares an **optional** `canvas` peer → benign pnpm warning) |

> **Pinning note:** passing exact version specs to `pnpm add` pins exact regardless of the caret
> default — so the testing-library/jsdom group also landed exact. That's fine (more reproducible, and
> the lockfile governs CI anyway); only the `@vitest/*` trio *needs* it.

---

## 4. Gotchas hit & how they were fixed

The brittle parts. Each is symptom → cause → fix.

### 4.1 `tsc -b` failed with "Cannot find name 'describe'" — but the tests ran fine

*Symptom:* `pnpm test:run` passed, but `pnpm build` failed with
`TS2593: Cannot find name 'describe'` / `'it'` / `'expect'` on every test file.

*Cause:* the include/exclude globs used brace expansion — `src/**/*.{test,spec}.{ts,tsx}`.
**TypeScript's tsconfig globs support only `*`, `?`, and `**` — not `{a,b}` brace expansion.** So tsc
matched *nothing*: the test files were never added to `tsconfig.test.json` (no vitest types) and were
never excluded from `tsconfig.app.json` (which has only `vite/client` types) → "describe undefined".
Vitest's own globber (tinyglobby) *does* expand braces, which is why the tests ran — masking the
misconfiguration until the build surfaced it.

*Fix:* enumerate the patterns in **both** tsconfigs (and keep the brace form only in
`vitest.config.ts`, where it's valid):

```jsonc
"src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx", "src/test"
```

*Lesson:* don't trust that a glob shared between Vite and TypeScript means the same thing in both.
Run `pnpm build`, not just the tests, to catch it.

### 4.2 Vitest pins to Vite's major version — verify before installing

*Cause:* Vitest's peer dependency tracks the Vite major (e.g. Vitest 3.x → Vite 5/6/7). On Vite 8 a
too-old Vitest won't install. *Fix:* checked the live registry first —
`vitest@4.1.9` declares `vite: ^6.0.0 || ^7.0.0 || ^8.0.0`, so Vite 8 is supported. **Verify against
`npm view` / the registry, not a blog** — this is exactly the fact stale docs get wrong.

### 4.3 `mergeConfig` needs an object-form `vite.config.ts`

*Cause:* `mergeConfig(viteConfig, …)` assumes the imported default export is a resolved config
**object**. If `vite.config.ts` exported a **function** (`defineConfig(({ mode }) => …)`), the merge
would choke. *Fix:* confirmed this repo's config is object-form — `export default defineConfig({ … })`
— and the `runtimeConfig` plugin keeps its server-only behaviour *inside* its `configureServer`/
`configurePreviewServer` hooks (neither runs under Vitest), not via a
config callback. Safe. (If it were function-form, you'd call it or lift the plugin array out.)

### 4.4 jest-dom has a Vitest-specific entry point

*Cause:* the default `@testing-library/jest-dom` import targets Jest's `expect`. *Fix:* import the
**`/vitest`** entry in the setup file: `import "@testing-library/jest-dom/vitest"`.

### 4.5 RTL auto-cleanup depends on a global `afterEach`

*Cause:* RTL registers automatic DOM cleanup between tests only if it finds a global `afterEach` at
import time. *Fix:* `globals: true` in the Vitest config provides it — so no manual `cleanup()` is
needed. (This is a second, independent reason to enable globals beyond import-free `describe`/`it`.)

### 4.6 `coverage/` is written to disk

*Cause:* `test:coverage` (v8 reporter) writes a `coverage/` directory. *Fix:* added `coverage` to
`.gitignore`.

---

## 5. From-scratch setup recipe (do this on the next project)

Assumes a Vite + React + TypeScript app using `tsc -b` project references (like this repo). Adjust
versions to whatever the registry shows is current — and **re-verify the Vitest↔Vite peer range**.

1. **Install** (the `@vitest/*` trio exact; the rest can be caret):
   ```bash
   pnpm add -D --save-exact vitest @vitest/coverage-v8 @vitest/ui
   pnpm add -D @testing-library/react @testing-library/dom @testing-library/jest-dom \
              @testing-library/user-event jsdom
   ```
2. **`vitest.config.ts`** — merge onto the existing Vite config:
   ```ts
   import { defineConfig, mergeConfig } from "vitest/config"
   import viteConfig from "./vite.config.ts"

   export default mergeConfig(
     viteConfig,
     defineConfig({
       test: {
         environment: "jsdom",
         globals: true,
         setupFiles: ["./src/test/setup.ts"],
         include: ["src/**/*.{test,spec}.{ts,tsx}"], // braces OK here
       },
     })
   )
   ```
   (Confirm `vite.config.ts` is object-form — see §4.3.)
3. **`src/test/setup.ts`**: `import "@testing-library/jest-dom/vitest"`.
4. **`tsconfig.test.json`** — copy `tsconfig.app.json`, then:
   `types: ["vitest/globals", "@testing-library/jest-dom"]`, its own `tsBuildInfoFile`, and
   `include` the **enumerated** test globs + `src/test` (no braces — §4.1).
5. **`tsconfig.json`** — add `{ "path": "./tsconfig.test.json" }` to `references`.
6. **`tsconfig.app.json`** — add `exclude` for the enumerated test globs + `src/test`.
7. **Scripts** — `test`, `test:run`, `test:ui`, `test:coverage` (see §3.1).
8. **Gates** — pre-push runs `pnpm test:run` after the build; add a CI `test` job mirroring the build
   job's setup, running `pnpm test:run`.
9. **`.gitignore`** — add `coverage`.
10. **Write a first test** and run `pnpm build && pnpm test:run` to prove the whole gate.

---

## 6. First run & validation (what "done" looked like)

1. **`pnpm test:run`** → `Test Files 2 passed (2)`, `Tests 4 passed (4)`.
2. **`pnpm build`** (`tsc -b && vite build`) → green; `tsc -b` now type-checks the test project, and
   `dist/` contains **no** `*.test.*` files (tests aren't bundled — only reachable-from-`index.html`
   code is).
3. **`pnpm biome ci`** → clean (14 files; the bare globals aren't flagged — Biome defers to TS).
4. **`pnpm test:coverage`** → summary emitted (100% of touched lines: 7/7 stmts, 4/4 branches).
5. **Isolation proof** — `tsc -p tsconfig.test.json --listFiles` lists the two tests + `setup.ts`;
   `tsc -p tsconfig.app.json --listFiles` lists **none** of them. Each file lives in exactly one
   project.

---

## 7. Operating it

- **Run modes:** `pnpm test` (watch, dev) · `pnpm test:run` (one-shot, CI/pre-push) ·
  `pnpm test:ui` (browser dashboard) · `pnpm test:coverage` (v8 report).
- **Where tests live:** beside the code they cover, as `*.test.ts` / `*.test.tsx`.
- **No mocking for `<App />`:** `getConfig()` (`src/lib/app-config.ts`) falls back to
  `{ env: "local", … }` when `window.__APP_CONFIG__` is unset — the jsdom case — so components render
  against that fallback without stubbing.
- **Query harness** (added with the TanStack Query layer): components that call `useQuery` render
  via `renderWithClient` (`src/test/render-with-client.tsx`) — a fresh per-test client built by
  `createTestQueryClient` (`src/test/query-client.ts`) from the *real* app factory with `retry:
  false` (no backoff waits in error tests) + `gcTime: Infinity` (no post-teardown gc timers). Seed
  the cache before mount (`client.setQueryData`) for fetch-free determinism — `src/App.test.tsx` is
  the reference. Mocking layers, the console-spy-the-seam move, and the no-fake-timers rule:
  [`tanstack-query-setup.md`](tanstack-query-setup.md) §Testing recipe.
- **Convention:** assert via roles/text (RTL), not implementation details.
- **Branch protection:** after the CI `test` job runs once on a PR, add it to `main`'s required checks.

---

## 8. Deferred / future

- **MSW** (Mock Service Worker) for **HTTP/API** mocking once real third-party endpoints exist
  (the Binance layer) — until then, tests mock `globalThis.fetch` / seed the query cache (see
  [`tanstack-query-setup.md`](tanstack-query-setup.md) §Testing recipe; MSW also just fakes fetch
  one layer lower, so adopting it later invalidates nothing). Allow-list its
  build in `pnpm-workspace.yaml` (`allowBuilds`) if pnpm flags one at that point. WebSocket mocking
  at the transport layer is already solved without it by the hand-rolled `FakeWebSocket` — the
  rationale lives in [`ws-transport-architecture.md`](ws-transport-architecture.md#testing).
- **Playwright** (or Vitest browser mode) for end-to-end / real-browser tests.
- **Coverage thresholds** (`test.coverage.thresholds`) + uploading the report in CI.
- **`vitest --typecheck`** for type-level tests (`expectTypeOf`) when there's typed domain logic.
- A **CD** unit-test stage — evaluated and dropped as redundant (CI already runs the suite;
  build-once-promote ships the tested artifact unchanged; deploy-time checks are `smoke.sh`). See
  `docs/cd-setup.md` §8.
