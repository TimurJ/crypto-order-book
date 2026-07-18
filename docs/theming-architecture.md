# Theming — architecture & decisions

How light/dark theming works across the app — the class-based dark mode, the provider that drives
it, the design tokens it switches, and the decisions behind each piece.

> **Status:** implemented **2026-06-24** (initial scaffold); split into provider + context during
> the Biome migration (**2026-06-27**); chronicled **2026-07-18**. Deferred: syncing the
> `theme-color` meta tags to the in-app override — see [Roadmap](#roadmap).
>
> This is the long-form architecture record. The short version lives in
> [`CLAUDE.md`](../CLAUDE.md#architecture) (rationale) and [`README.md`](../README.md#tech-stack)
> (the one-line mention). Update those on changes; update this file when the theming architecture
> or roadmap changes.

---

## What's implemented today

Class-based dark mode: `ThemeProvider` resolves the user's preference to `"light"` or `"dark"` and
toggles a **`.dark` class on the root element**; Tailwind v4's
`@custom-variant dark (&:is(.dark *))` keys every `dark:` utility off that class. The stored
preference is three-valued — `"dark" | "light" | "system"` — and `"system"` stays *live*: an OS
scheme flip propagates immediately via a `matchMedia` change listener.

| Piece | Where | What it does |
|---|---|---|
| `ThemeProvider` | `src/components/theme-provider.tsx` (only export) | Owns the preference state; applies the resolved theme to the root element; wires the keybind, cross-tab sync, and anti-flash |
| `useTheme` / `ThemeProviderContext` / `Theme` | `src/components/theme-context.ts` | The consumption surface — `useTheme()` throws outside the provider |
| Dark variant + tokens | `src/index.css` | `@custom-variant dark (&:is(.dark *))`; OKLch design tokens in `:root` (light) and `.dark` blocks, surfaced to Tailwind via `@theme inline` |
| Mount point | `src/main.tsx` | `<ThemeProvider><App /></ThemeProvider>` |
| Bootstrap `theme-color` | `index.html` | Media-based light/dark `<meta name="theme-color">` — tracks the **OS** scheme only (see [Roadmap](#roadmap)) |

Behaviors, all in the provider:

- **Persistence** — the preference is stored in `localStorage` (key `"theme"` by default) and
  validated on read (`isTheme`); an invalid/missing value falls back to `defaultTheme`
  (`"system"`), so cleared or garbage storage can't wedge the app.
- **The `d` keybind** — toggles light/dark globally. Guarded three ways: `event.repeat` (held key),
  modifier keys (`meta`/`ctrl`/`alt` — never steals Cmd/Ctrl-D bookmark), and editable targets
  (`input`/`textarea`/`select`/`contenteditable`, via `isEditableTarget`) so typing a `d` never
  flips the theme.
- **Cross-tab sync** — a `storage` event listener mirrors changes from other tabs; a removed or
  invalid value resets to `defaultTheme`. Two tabs never disagree.
- **Anti-flash on switch** — `disableTransitionsTemporarily()` injects a transient
  `*{transition:none}` `<style>`, swaps the class, then removes it after a `getComputedStyle`
  reflow + double `requestAnimationFrame`, so colors snap instead of smearing through every
  element's transition. Opt out per-mount with `disableTransitionOnChange={false}`.
  **Do not simplify the removal timing:** dropping the `<style>` too eagerly re-arms transitions
  before the swap paints and the color smear returns. **Acceptance test:** toggle the theme in
  **both Chromium and Firefox** with an element on screen that animates a **pseudo-element** (a
  focus ring, or a `::before`/`::after` overlay/indicator) — *not* just a plain button, which
  exercises none of the `::before`/`::after` selectors — and confirm no fade smear. The current
  scaffold has **no** pseudo-element-animating component, so that case is **untestable today** —
  re-check when one lands.

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Dark-mode strategy | **`.dark` class** + `@custom-variant dark (&:is(.dark *))`, not Tailwind's media-query default | A media strategy can't express "user chose light while the OS is dark" — a manual override plus a system option needs a class the app controls |
| Preference vs. resolved | Store the **preference** (`dark`/`light`/`system`); resolve to `light`/`dark` only at apply time, never persist the resolved value | Persisting the resolved value would freeze `"system"` at whatever the OS was at save time |
| Two-file split | Provider component in `theme-provider.tsx`; context + `useTheme` + `Theme` type in `theme-context.ts` | The strict Fast-Refresh rule (`useComponentExportOnlyModules`) forbids mixed exports — the split fixed a real Fast-Refresh bug that an old `eslint-disable` had been masking ([`biome-setup.md`](biome-setup.md#41-a-dead-eslint-disable-was-masking-a-real-fast-refresh-bug)) |
| Storage validation | `isTheme()` type-guard on every read (init and `storage` events) | `localStorage` is user-editable input; never trust it into a union type |
| Keybind semantics | Pressing `d` always lands on an **explicit** light/dark — from `"system"`, the opposite of the current OS theme | A toggle must visibly change the theme every press; staying in `"system"` couldn't guarantee that |
| Anti-flash timing | `getComputedStyle` reflow + **double** `rAF` before removing the `<style>` | The minimum that reliably outlives the swap's paint — gotcha + acceptance test under [What's implemented today](#whats-implemented-today) |
| CSP interaction | The anti-flash `<style>` element is why `style-src` includes `'unsafe-inline'` | Locking `style-src` was evaluated and rejected as ~0-value — full rationale in [`security-headers-setup.md`](security-headers-setup.md) |
| Tokens | OKLch CSS custom properties in `:root`/`.dark`, mapped to Tailwind via `@theme inline` (colors, radius scale, fonts) | The shadcn `base-mira` scaffold's shape: utilities stay semantic (`bg-background`), themes swap by overriding the underlying variables |

## Testing

jsdom omits `window.matchMedia`, which the provider's `"system"` path calls at mount — every
component test rendering under `ThemeProvider` would crash without the stub in
`src/test/setup.ts`. Details: [`vitest-setup.md`](vitest-setup.md).

## Reuse recipe (for the next project)

1. Copy `src/components/theme-provider.tsx` + `src/components/theme-context.ts` (keep the two-file
   split — the Fast-Refresh rule will flag a merge).
2. Mount `<ThemeProvider>` around the app in `main.tsx`.
3. In the Tailwind entry CSS: `@custom-variant dark (&:is(.dark *))`, a `:root` block (light
   tokens), a `.dark` block (dark tokens), and an `@theme inline` block mapping
   `--color-*`/`--radius-*`/`--font-*` onto them. shadcn's `base-mira` init generates all of this.
4. Stub `window.matchMedia` in the test setup file (jsdom omits it).
5. CSP: keep `style-src 'unsafe-inline'`, or pass `disableTransitionOnChange={false}` and drop the
   anti-flash (accepting the transition smear on theme switch). Re-derive the new project's CSP
   rather than copying this repo's — see
   [`security-headers-setup.md`](security-headers-setup.md#-re-derive-the-csp-per-project--do-not-copy-this-one).
6. Verify the anti-flash with the pseudo-element acceptance test (under
   [What's implemented today](#whats-implemented-today)) once a pseudo-element-animating component
   exists.

## Roadmap

- **Sync `theme-color` to the in-app override.** The `index.html` meta tags are media-based, so
  the browser-chrome color tracks the **OS** scheme even after a `d`-key/`localStorage` override —
  wire `applyTheme()` to update the meta tag. (Also tracked in
  [`production-readiness.md` §7](production-readiness.md#7-branding--html-metadata--done).)
- **Theme switcher UI.** The `d` keybind and OS preference are the only inputs today; a visible
  three-state control (light/dark/system) lands with the app's real toolbar.

## References

- [Tailwind CSS — dark mode (class strategy / custom variant)](https://tailwindcss.com/docs/dark-mode)
- [shadcn/ui — theming](https://ui.shadcn.com/docs/theming)
- [`next-themes`](https://github.com/pacocoursey/next-themes) — the mechanism ancestry of the
  scaffold's provider (storage sync, anti-flash, system resolution)
