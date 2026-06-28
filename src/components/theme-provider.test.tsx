import { render, waitFor } from "@testing-library/react"

import { ThemeProvider } from "./theme-provider.tsx"

// On a theme swap the provider suppresses transitions by toggling the `theme-transitions-off` class
// on <html> (a bundled CSS rule) — NOT by injecting a runtime <style>. That distinction is what lets
// the CSP keep a strict `style-src 'self'`, so it's worth a regression guard. jsdom can't observe
// the visual transition itself; the cross-engine no-smear check is manual (see
// docs/security-headers-setup.md). We mount with the default "system" theme — the realistic path —
// which resolves via the window.matchMedia stub in src/test/setup.ts (matches: false → light).
describe("ThemeProvider transition suppression", () => {
  const root = document.documentElement

  afterEach(() => {
    root.classList.remove("theme-transitions-off", "light", "dark")
    localStorage.clear()
  })

  it("toggles the suppression class on a theme change instead of injecting a <style>", async () => {
    const styleCountBefore = document.head.querySelectorAll("style").length

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    )

    // "system" resolves through the stubbed matchMedia (matches: false → light).
    expect(root.classList.contains("light")).toBe(true)

    // Suppression class added synchronously in the mount effect; removal deferred to a double rAF.
    expect(root.classList.contains("theme-transitions-off")).toBe(true)

    // No runtime <style> was injected — the CSP-safety property this change protects.
    expect(document.head.querySelectorAll("style")).toHaveLength(
      styleCountBefore
    )

    // Transitions are re-enabled on a later frame.
    await waitFor(() => {
      expect(root.classList.contains("theme-transitions-off")).toBe(false)
    })
  })
})
