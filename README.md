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

## Adding components

To add shadcn/ui components, run:

```bash
npx shadcn@latest add button
```

This places UI components in `src/components/ui`. Import them via the `@` alias:

```tsx
import { Button } from "@/components/ui/button"
```
