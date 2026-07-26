# Code style

## Comments

- Write **new** code with zero comments — no header blocks, no rationale notes, no inline explanations —
  unless comments are explicitly requested. Put design rationale in the conversation, the plan file, or
  `docs/`.
- **Never strip pre-existing comments** from files the user authored unless told to. Large parts of this
  repo are deliberately commented — `src/lib/order-book/order-book-sync.ts`, `worker/index.ts`,
  `src/main.tsx` — and that prose is intentional, not clutter.
- When comments *are* requested, the split is by **audience**, not preference:
  - **JSDoc (`/** */`) only on named things used elsewhere** — functions, types, exported consts, public
    methods. It binds to the symbol below it and drives editor hover at call sites, so it documents the
    *contract*.
  - **`//` for anything inside a function body** — step explanations, landmines, "why this and not the
    obvious thing". JSDoc mid-body binds to nothing.
  - Failure modes: a bare `//` above an exported symbol throws away the free hover hint; JSDoc floating
    mid-body attaches to nothing.

## UI primitives

- Never import `@base-ui/react` directly in app or feature code — because Base UI exists here only as the
  internal dependency of shadcn's vendored components in `src/components/ui/**`, and reaching past shadcn
  to it defeats the point of using shadcn at all. Vendor a primitive with
  `pnpm dlx shadcn@latest add <component>`; if the registry doesn't offer it, hand-build from scratch.
  Do **not** hand-wire Base UI parts as a fallback. Feature code imports from `@/components/ui/*` only.

## SVG / XML

- `--` is illegal anywhere inside an XML comment, and every CSS custom property starts with `--`, so
  writing a token name like `--chart-4` into an SVG comment silently breaks the file: the browser fails to
  parse it and keeps the cached asset, while grep, curl, build, and tests all still pass. Write token
  names without the leading dashes ("the chart-4 token"), and parser-validate after **any** `.svg` edit:
  `python3 -c "import xml.dom.minidom; xml.dom.minidom.parse('path')"`. A content grep proves bytes, not
  parseability.
