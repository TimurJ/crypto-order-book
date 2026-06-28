import type { ReactNode } from "react"
import { ErrorBoundary, type FallbackProps } from "react-error-boundary"

import { Button } from "@/components/ui/button"
import { reportError } from "@/lib/report-error.ts"

// Fallback UI rendered when the root boundary catches a render error. Kept deliberately
// simple and self-contained — it must never depend on app state or it could throw while
// trying to render the error. Shows the underlying message only in dev; prod gets generic copy.
export function RootErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error)

  return (
    <div
      role="alert"
      className="flex min-h-svh items-center justify-center p-6"
    >
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <h1 className="font-medium text-foreground">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error broke this page. You can try again, or reload the
          app.
        </p>
        {import.meta.env.DEV && (
          <pre className="overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
            {message}
          </pre>
        )}
        <div className="flex gap-2">
          <Button onClick={resetErrorBoundary}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  )
}

// Top-level boundary for the whole React tree. Catches render-time errors, routes them to
// the reporting seam (source "react:boundary"), and shows RootErrorFallback with a recovery
// path. NOTE: React error boundaries do NOT catch errors from event handlers or async code
// (e.g. a bad WebSocket frame in onmessage). Those are observed by the global handlers in
// main.tsx, or — to surface a *widget* fallback — pushed in via useErrorBoundary().showBoundary().
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={RootErrorFallback}
      onError={(error, info) =>
        reportError(error, {
          componentStack: info.componentStack,
          source: "react:boundary",
        })
      }
    >
      {children}
    </ErrorBoundary>
  )
}
