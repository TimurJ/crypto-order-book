import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { StrictMode } from "react"
import { createRoot, type RootOptions } from "react-dom/client"

import "./index.css"
import { App } from "./App.tsx"
import { RootErrorBoundary } from "@/components/root-error-boundary.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { createQueryClient } from "@/lib/query/query-client.ts"
import { reportError } from "@/lib/report-error.ts"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root not found")
}

// React 19 root error hooks centralize logging for errors outside the boundary's reach.
// They REPLACE React's default console logging, and React's docs advise against attaching
// them in development (you'd lose the dev error overlay) — so they're production-only.
// `import.meta.env.PROD` is Vite's build-mode flag, not deployment-env config, so this does
// not break the runtime-config rule. No onCaughtError: caught render errors are already
// reported by the boundary's onError (react-error-boundary), and setting both would double-report.
const rootOptions: RootOptions | undefined = import.meta.env.PROD
  ? {
      onUncaughtError: (error, info) =>
        reportError(error, {
          componentStack: info.componentStack,
          source: "react:uncaught",
        }),
      onRecoverableError: (error, info) =>
        reportError(error, {
          componentStack: info.componentStack,
          source: "react:recoverable",
        }),
    }
  : undefined

// Global safety net for the async errors React boundaries structurally cannot catch
// (rejected promises, errors thrown in event handlers / timers). Logging only — no recovery;
// to surface a widget fallback from async code, use useErrorBoundary().showBoundary() instead.
window.addEventListener("unhandledrejection", (event) => {
  reportError(event.reason, { source: "window:unhandledrejection" })
})
window.addEventListener("error", (event) => {
  reportError(event.error ?? event.message, { source: "window:error" })
})

// One QueryClient per tab, created once at module scope (an SPA has no SSR request-isolation
// concern — see docs/tanstack-query-setup.md for the shape to use if that ever changes).
const queryClient = createQueryClient()

createRoot(rootElement, rootOptions).render(
  <StrictMode>
    <RootErrorBoundary>
      {/* Devtools self-exclude from production bundles (NODE_ENV check, statically replaced
          by Vite) — verified via `grep -ri react-query-devtools dist/` after a build. */}
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>
)
