import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config.ts"

// Test config layered onto the app's Vite config (mergeConfig) so tests inherit the `@`→src alias
// and the react()/tailwindcss() plugins without duplicating them. The custom runtimeConfig plugin
// is inert here: its configureServer hook is dev-server-only and transformIndexHtml never runs for
// component tests. Kept separate from vite.config.ts to keep the build config free of test concerns.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // Exposes describe/it/expect as globals (typed via tsconfig.test.json) and, crucially, gives
      // React Testing Library the global afterEach it hooks into for automatic cleanup between tests.
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  })
)
