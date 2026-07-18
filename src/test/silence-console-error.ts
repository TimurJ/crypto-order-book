import { vi } from "vitest"

// Silences the console noise reportError emits on error-path tests. Returns the spy
// so tests can assert on what was reported. Restored by vi.restoreAllMocks() /
// the suite's teardown.
export const silenceConsoleError = () =>
  vi.spyOn(console, "error").mockImplementation(() => {})
