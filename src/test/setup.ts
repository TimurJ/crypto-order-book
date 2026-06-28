// Runs before every test file (vitest.config.ts `setupFiles`). The /vitest entry registers
// @testing-library/jest-dom's custom matchers (toBeInTheDocument, etc.) on Vitest's `expect`.
import "@testing-library/jest-dom/vitest"
