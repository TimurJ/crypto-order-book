# Linting & formatting setup — Biome (migration from ESLint + Prettier)

A step-by-step record of how the project moved from ESLint + Prettier to **Biome**, the decisions
behind the config, the lint findings the migration surfaced (and how each was fixed in code), and a
from-scratch recipe to reproduce it on the next project.

> **Status:** live since **2026-06-27** (commit `3272902`, PR #1, branch `chore/biome-migration` — the
> project's first tooling change). `biome.json` has not changed since, so the committed config *is* the
> migration artifact.
>
> This is the long-form history. The short versions live in [`README.md`](../README.md#tooling)
> (how-to) and [`CLAUDE.md`](../CLAUDE.md#linting--formatting--biome) (rationale). Update those on
> changes; update this file when the *setup itself* changes.
>
> **Downstream:** Biome is *consumed by* two later subsystems — the pre-commit hook runs `biome check`
> ([`docs/husky-setup.md`](husky-setup.md)) and CI runs `biome ci` ([`docs/ci-setup.md`](ci-setup.md)).
> This doc owns the Biome config itself; those own how it's enforced.

---

## 1. Goals & why these choices

Replace **two** tools and their plugin stacks (ESLint + `typescript-eslint` + react plugins, and
Prettier + `prettier-plugin-tailwindcss`) with **one** — Biome. The payoff: a single fast Rust binary,
one config file, lint **and** format together, and no more keeping a dozen interdependent plugin
versions in sync.

Two constraints shaped the migration:

- **Faithful formatting.** Biome's formatter output had to be **byte-identical** to the old Prettier
  config, so the migration produced no churn diff (the mapping is exact — see §3.1).
- **Stricter linting, fixed in code — not suppressed.** Rather than mechanically reproduce the old
  ESLint rules, the migration **kept Biome's stricter defaults** and resolved every finding with a real
  code change. Suppression comments (`biome-ignore`) are treated as a code smell — a scoped config
  override for vendored code is acceptable, a per-line ignore is a last resort.

---

## 2. Architecture decisions (the locked forks)

| Decision | Choice | Why |
|---|---|---|
| Version | **Biome `2.5.1`, pinned exact** (no caret) | A formatter's output must be deterministic across machines/CI; a caret bump could re-flow files |
| Scope | **`.ts`/`.tsx` only** — `files.includes: ["**/*.{ts,tsx}", "!dist"]` | Deliberately excludes CSS/JSON: Biome has open upstream bugs parsing Tailwind v4 at-rules; Vite/Tailwind already own `src/index.css` |
| Formatter | **Byte-identical to the old Prettier** | Faithful migration, zero reformat churn (mapping in §3.1) |
| Linter rules | **`preset: "recommended"` + `domains.react: "recommended"`** | The modern key — *not* the deprecated `rules.recommended: true` (2.5.1 flags it) |
| Import organizing | **`assist: { enabled: false }`** | No automatic import reordering (kept off deliberately) |
| Tailwind class sorting | **Dropped** | No Biome equivalent to `prettier-plugin-tailwindcss`; the nursery `useSortedClasses` is unsafe-fix-only and can't read the v4 `@theme`. Low value — `twMerge` resolves runtime conflicts |
| Fast-Refresh rule | **`useComponentExportOnlyModules: "error"` (strict)** | Explicit choice — stricter than the old `react-refresh/only-export-components` |
| VCS awareness | **`vcs.useIgnoreFile: true`** | Biome respects `.gitignore` |
| Vendored code | **`overrides` → rule `off` for `src/components/ui/**`** | shadcn primitives co-locate `cva` with components by design; a scoped override survives `shadcn add` (preferred over per-line ignores) |

The full `biome.json` is the source of truth; the table above is the *why*.

---

## 3. What changed, file by file

Everything below is commit `3272902`.

**Removed**

- **`eslint.config.js`** — the flat config (`@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks`
  + `eslint-plugin-react-refresh`, `globals.browser`, `globalIgnores(['dist'])`).
- **`.prettierrc`** — Prettier config (incl. `prettier-plugin-tailwindcss`, `tailwindStylesheet`,
  `tailwindFunctions: ["cn", "cva"]`).
- **`.prettierignore`**.

**Added**

- **`biome.json`** — the config (see §2; unchanged since).
- **`.vscode/extensions.json`** — recommends the `biomejs.biome` editor extension.
- **`.vscode/settings.json`** — `editor.formatOnSave: true`, `codeActionsOnSave: { source.fixAll.biome:
  "explicit" }`, `[typescript]`/`[typescriptreact]` `defaultFormatter: biomejs.biome`, and
  `[css].formatOnSave: false` (CSS is off-limits to Biome). Committed via the `.gitignore` allowlist.
- **`src/components/theme-context.ts`** — extracted from the provider (see §4.1).

**Modified**

- **`package.json`** — scripts: `lint` `eslint .` → **`biome lint`**, `format` `prettier --write …` →
  **`biome format --write`**, **plus a new `check` → `biome check --write`** (lint + format + safe
  fixes). devDeps: removed the **8** eslint/prettier packages, added **`@biomejs/biome: "2.5.1"`** (exact).
- **`.gitignore`** — added `!.vscode/settings.json` so the shared editor settings are committed.
- **`index.html`** — `<title>` `vite-app` → `Crypto Order Book` (incidental cleanup in the same commit).
- **`pnpm-lock.yaml`** — large shrink as the eslint/prettier dependency trees dropped out.
- **Five code fixes** — `src/App.tsx`, `src/components/theme-provider.tsx`, `src/main.tsx`,
  `vite.config.ts` (see §4).

### 3.1 Prettier → Biome formatter mapping (byte-identical)

| Prettier (`.prettierrc`) | Biome (`biome.json`) |
|---|---|
| `endOfLine: "lf"` | `formatter.lineEnding: "lf"` |
| `semi: false` | `javascript.formatter.semicolons: "asNeeded"` |
| `singleQuote: false` | `javascript.formatter.quoteStyle: "double"` (+ `jsxQuoteStyle: "double"`) |
| `tabWidth: 2` | `formatter.indentWidth: 2` (+ `indentStyle: "space"`) |
| `trailingComma: "es5"` | `javascript.formatter.trailingCommas: "es5"` |
| `printWidth: 80` | `formatter.lineWidth: 80` |
| `plugins: ["prettier-plugin-tailwindcss"]` | **dropped** (no equivalent — see §2) |

### 3.2 ESLint → Biome lint mapping

| ESLint (`eslint.config.js`) | Biome (`biome.json`) |
|---|---|
| `@eslint/js` recommended | `linter.rules.preset: "recommended"` |
| `typescript-eslint` recommended | covered by `recommended` (Biome lints TS natively) |
| `eslint-plugin-react-hooks` | `linter.domains.react: "recommended"` |
| `eslint-plugin-react-refresh` (`only-export-components`) | `useComponentExportOnlyModules` (kept strict at `"error"`) |

---

## 4. Gotchas hit & how they were fixed

The valuable part. The migration's stricter linting surfaced real issues — **all fixed in code, zero
`biome-ignore`s**. Each is symptom → cause → fix.

### 4.1 A dead `eslint-disable` was masking a real Fast-Refresh bug

*Symptom:* `theme-provider.tsx` began with `/* eslint-disable react-refresh/only-export-components */`.
*Cause:* the file exported a component **and** non-components (`useTheme` hook, `ThemeProviderContext`,
the `Theme`/`ThemeProviderState` types) — a genuine mixed-export issue that breaks React Fast Refresh.
The blanket disable had been silencing it.
*Fix:* split the context, the `useTheme` hook, and the `Theme` type into a new
**`src/components/theme-context.ts`**; the provider now imports `{ ThemeProviderContext, type Theme }`
and exports **only** the `ThemeProvider` component. The disable comment is gone.
*Lesson:* this is exactly why suppressions are avoided — they hide the problem instead of fixing it.

### 4.2 `useComponentExportOnlyModules` on `App.tsx`

*Cause:* `App.tsx` had both `export function App()` and a redundant `export default App`.
*Fix:* drop the default export; `main.tsx` imports the named `{ App }`.

### 4.3 `useComponentExportOnlyModules` on the vendored shadcn `ui/button.tsx`

*Cause:* shadcn primitives co-locate their `cva` variant definitions with the component in one file —
by design, and regenerated by `shadcn add`.
*Fix:* a scoped `overrides` block turns the rule **`off`** for `src/components/ui/**`. A directory
override (not per-line ignores) keeps the rule strict everywhere we author code while leaving vendored
files alone — and it survives re-running `shadcn add`.

### 4.4 `noNonNullAssertion` in `main.tsx`

*Cause:* `createRoot(document.getElementById("root")!)` used a non-null assertion.
*Fix:* guard it —
```ts
const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Root element #root not found")
}
createRoot(rootElement).render(/* … */)
```

### 4.5 `useNodejsImportProtocol` in `vite.config.ts`

*Cause:* `import path from "path"` — the recommended preset wants the explicit Node protocol.
*Fix:* `import path from "node:path"`.

### 4.6 Deprecated config key

*Cause:* the obvious `rules.recommended: true` is flagged **deprecated** by the 2.5.1 runtime.
*Fix:* use `rules.preset: "recommended"` instead.

### 4.7 CSS / Tailwind v4 at-rules break Biome's CSS parser

*Cause:* Biome's CSS parser has open upstream bugs on Tailwind v4 at-rules (`@theme`,
`@custom-variant`, `@plugin`) in `src/index.css`.
*Fix:* scope Biome to `.ts`/`.tsx` only (§2). **Never** point its CSS formatter/linter at `index.css` —
Vite + Tailwind own that file. (`.vscode/settings.json` also sets `[css].formatOnSave: false`.)

---

## 5. From-scratch setup recipe (do this on the next project)

Assumes a Vite + React + TS project currently on ESLint + Prettier.

1. **Install Biome, exact:**
   ```bash
   pnpm add -D --save-exact @biomejs/biome
   ```
2. **Write `biome.json`** — set `files.includes` to `["**/*.{ts,tsx}", "!dist"]`; mirror your current
   Prettier settings in `formatter` + `javascript.formatter` (use §3.1 as the map); set
   `linter.rules.preset: "recommended"` + `domains.react: "recommended"`; `assist.enabled: false`;
   `vcs.useIgnoreFile: true`; and an `overrides` entry turning `useComponentExportOnlyModules` `off` for
   any vendored UI dir (e.g. `src/components/ui/**`).
3. **Swap `package.json` scripts:** `lint: "biome lint"`, `format: "biome format --write"`,
   `check: "biome check --write"`.
4. **Remove the old tooling:** delete `eslint.config.js`, `.prettierrc`, `.prettierignore`, and uninstall
   the eslint/prettier/plugin devDeps.
5. **Editor integration:** `.vscode/extensions.json` recommending `biomejs.biome`; `.vscode/settings.json`
   with `formatOnSave`, `source.fixAll.biome: "explicit"`, per-language `defaultFormatter`, and
   `[css].formatOnSave: false`. Allow it through `.gitignore` (`!.vscode/settings.json`).
6. **Run `pnpm check`** and **fix every finding in code** — split mixed-export modules, drop redundant
   default exports, guard non-null assertions, add the `node:` import protocol. Reach for a scoped
   `overrides` only for vendored code; avoid per-line `biome-ignore`.
7. **Confirm `pnpm lint` exits 0** with zero diagnostics.

---

## 6. First run & validation (what "done" looked like)

- **`pnpm lint`** → exit 0, **zero diagnostics**.
- **Formatter parity** — reformatting the codebase with Biome produced no churn beyond the intended
  changes; the output matches the old Prettier config byte-for-byte (§3.1).
- **All findings fixed in code** — the five issues in §4.1–4.5 were resolved by refactor/guard, the
  vendored case by a directory override, and **no `biome-ignore` comments were added**.
- The previously-masked Fast-Refresh bug (§4.1) is genuinely fixed, not re-silenced.

---

## 7. Operating it

- **Scripts:** `pnpm lint` (read-only lint) · `pnpm format` (format, write) · `pnpm check`
  (lint + format + apply safe fixes — the everyday command).
- **Convention — fix in code, don't suppress.** Exhaust refactors (split modules, rename, restructure
  exports) before any `biome-ignore`. A scoped `overrides` for vendored/third-party dirs is the
  acceptable middle ground; per-line ignores are a last resort.
- **Vendored shadcn:** keep the `src/components/ui/**` override; it's why `shadcn add` output lints clean.
- **Never point Biome at CSS** (§4.7) — `src/index.css` is Vite/Tailwind territory.
- **Enforcement is downstream:** the pre-commit hook runs `biome check` on staged files
  ([`husky-setup.md`](husky-setup.md)); CI runs `biome ci` ([`ci-setup.md`](ci-setup.md)). Both use this
  same pinned config, so editor, hook, and CI agree byte-for-byte.

---

## 8. Deferred / future

- **Tailwind class sorting** — revisit if Biome ships a stable, v4-`@theme`-aware equivalent to
  `prettier-plugin-tailwindcss`.
- **CSS formatting** — bring `src/index.css` into Biome once the Tailwind-v4 at-rule parsing bugs are
  fixed upstream.
- **Import organizing** — enable `assist` if automatic import sorting becomes desirable.
- **Wider scope** — extend `files.includes` to JSON/Markdown if a single formatter for those is wanted.
- **Upgrades** — use `biome migrate` to carry the config forward on future Biome version bumps.
