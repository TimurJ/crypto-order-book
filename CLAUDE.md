# CLAUDE.md

Guidance for working in this repository.

## Overview

`crypto-order-book` — a React 19 + TypeScript single-page app built with Vite 8, Tailwind
CSS v4, and shadcn/ui (the `base-lyra` style, which uses **Base UI** primitives — not Radix —
and Tabler icons). Package manager is **pnpm**.

> Status: **early scaffold**. The app currently renders the shadcn starter landing page
> (`src/App.tsx`) with theming wired up. There is no order-book domain code yet.

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

## Secrets

Never commit secrets / API keys. `.env*` is gitignored (except `.env.example`) — load config from
environment variables. **secretlint** (pre-commit, configured in `.secretlintrc.json` with the
recommended preset) scans every staged file as a safety net. Remember a browser SPA ships
everything to the client: exchange keys with trade/withdraw permissions must live behind a backend,
never in frontend code. A heavier **gitleaks** scan + CI enforcement arrive in the dedicated CI PR.

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
- **TypeScript:** `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`,
  `erasableSyntaxOnly`, `noUnusedLocals`/`noUnusedParameters`. Build uses project references
  (`tsc -b` over `tsconfig.app.json` + `tsconfig.node.json`). Target es2023,
  `moduleResolution: "bundler"`.

## Conventions / gotchas

- Prefer **named exports** for components (`App`, `ThemeProvider`, `Button` are all named;
  avoid `export default` for components).
- Imports use the **explicit file extension** (e.g. `import { App } from "./App.tsx"`) —
  required by `allowImportingTsExtensions`.
- Outside `src/components/ui/**`, **do not co-locate non-component exports** (hooks, context,
  `cva` definitions) with components in the same file — split them into their own module. The
  strict `useComponentExportOnlyModules` rule will flag it.
- Never point Biome at CSS. Fix lint findings in code rather than suppressing them.
- **Keep docs in sync:** on any **major change** (tooling, architecture, a new subsystem,
  scripts/hooks), update **both `README.md` and `CLAUDE.md`** in the same change.
