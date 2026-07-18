import { useQuery } from "@tanstack/react-query"
import { healthQueryOptions } from "./health-query.ts"

// House posture (docs/tanstack-query-setup.md): useQuery + local pending/error rendering —
// a failed health check degrades this one line, never the page (throwOnError stays false).
// Last-known-good wins: v5 keeps cached `data` when a background refetch fails, so the line
// only degrades when there's no health data at all — a transient blip never flips it.
export function HealthStatus() {
  const { data, isPending } = useQuery(healthQueryOptions())

  if (isPending) {
    return <span>api: checking…</span>
  }
  if (!data) {
    return <span className="text-destructive">api: unreachable</span>
  }
  return <span>{`api: ${data.status}`}</span>
}
