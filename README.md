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
replaced ESLint + Prettier. Configuration is in `biome.json`. See [`CLAUDE.md`](./CLAUDE.md)
for project conventions and the rationale behind the setup.

## Adding components

To add shadcn/ui components, run:

```bash
npx shadcn@latest add button
```

This places UI components in `src/components/ui`. Import them via the `@` alias:

```tsx
import { Button } from "@/components/ui/button"
```
