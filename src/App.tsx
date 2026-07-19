import { HealthStatus } from "@/features/health/health-status.tsx"
import { OrderBook } from "@/features/order-book/order-book.tsx"
import { getConfig } from "@/lib/app-config.ts"

export function App() {
  const { env } = getConfig()
  return (
    <div className="flex min-h-svh flex-col items-center gap-4 p-6">
      <header className="w-full max-w-2xl">
        <h1 className="font-heading text-lg font-medium">Crypto Order Book</h1>
      </header>
      <main className="flex w-full max-w-2xl flex-1 flex-col">
        <OrderBook />
      </main>
      <footer className="font-mono text-xs text-muted-foreground">
        env:{" "}
        <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
          {env}
        </span>{" "}
        · <HealthStatus /> · (Press <kbd>d</kbd> to toggle dark mode)
      </footer>
    </div>
  )
}
