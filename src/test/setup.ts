// Runs before every test file (vitest.config.ts `setupFiles`). The /vitest entry registers
// @testing-library/jest-dom's custom matchers (toBeInTheDocument, etc.) on Vitest's `expect`.
import "@testing-library/jest-dom/vitest"

// jsdom doesn't implement window.matchMedia; stub it so components that read prefers-color-scheme —
// e.g. ThemeProvider's default "system" theme — can be exercised under test rather than routed
// around. Defaults to no match (resolves to the light theme).
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})
