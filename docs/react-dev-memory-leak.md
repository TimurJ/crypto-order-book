# React dev-mode memory leak — User Timing buffer (known, upstream)

**Status: live issue** as of 2026-08-01 · react-dom **19.2.8** · observed on Chrome
150.0.7871.187, macOS. Dev server only — **production builds are unaffected**. Interim
policy: hard-refresh long-lived dev tabs. Re-verify on every react-dom bump with the
[checklist below](#verifying-the-fix-on-upgrade); when it passes, mark this doc resolved.

## Symptom

A `pnpm dev` tab left open grows its Chrome renderer process without bound — observed
7–8 GB for a single tab after a couple of hours, climbing 150–450 MB/min, with CPU for
the renderer also rising the longer the tab lives. The in-page numbers look innocent the
whole time: `performance.memory` reports a flat ~60 MB JS heap, DOM node count is
constant, and the app's own diagnostics show `resyncs 0 · dropped 0`. The growth is
renderer-side, outside the JS heap — macOS `footprint <pid>` / `vmmap --summary <pid>`
show it as dirty memory under "app-specific tag 14" (most likely PartitionAlloc, Blink's
C++ allocator), across 100k+ VM regions. This is why heap snapshots and the DevTools
Memory panel find nothing: the payload isn't JavaScript-reachable.

## Mechanism

React 19.2's **Component Performance Tracks** — the dev-only instrumentation behind the
"Components ⚛" custom track in Chrome's Performance panel — call `performance.measure()`
per rendered component per commit. In the installed
`react-dom-client.development.js` the only gate is capability detection
(`supportsUserTiming` = "`console.timeStamp` and `performance.measure` exist"), and the
build contains **zero** `clearMeasures`/`clearMarks` calls. User Timing entries
accumulate until explicitly cleared, and the spec puts no cap on the buffer (unlike
resource timing).

This app commits ~10×/sec (`@depth@100ms` stream → one render per commit), so under
StrictMode the buffer gains ~3,000–4,000 entries/sec (3,834/sec on the verification
run) ≈ 1 M entries per ~5 minutes ≈ ~15 GB/hour at the ~1.4 KB/entry observed here
(machine-specific observations, not universals). Any React 19.2 app leaks like this in dev; this one just commits often
enough to make it spectacular. The entries are recognizable in
`performance.getEntries()` by their zero-width-space-prefixed component names
(`​OrderBookLadder`, `​TooltipContent`, …).

## How it was pinned down (elimination chain)

Each row was a live intervention on a leaking dev tab, watching renderer RSS via `ps`:

| Intervention | Growth | Conclusion |
|---|---|---|
| All CSS transitions/animations disabled | unchanged | not animation churn |
| Bids-only view (half the rows) | ~unchanged | not DOM/row count |
| Frames delivered but ignored (no commits, no renders) | **flat, ~0% CPU** | per-commit pipeline is the driver |
| Production build, same live stream | **flat** | dev-only |
| React DevTools hook (`onCommitFiberRoot`) neutered | unchanged | not the extension, not react-refresh |
| `performance.getEntriesByType("measure")` | ~1 M entries | the payload, found |
| `performance.clearMeasures()` | growth pauses | confirmed — freed space refills |

Notes on the last row: RSS never shrinks after clearing — the allocator retains freed
pages — so recovering the memory means closing the tab (a same-site reload keeps the
renderer process and its retained pages). And removing the React DevTools *extension*
does **not** help: emission is capability-gated, not hook-gated; the extension is only a
viewer for entries React writes regardless.

## Upstream

facebook/react [PR #32736](https://github.com/facebook/react/pull/32736) moved the
component track to `console.timeStamp` for exactly this reason — timestamps don't
buffer. Yet 19.2.8 demonstrably still emits buffering measures, likely because 19.2's
"performance tracks show changed props" feature needs `performance.measure`'s
`properties` extension, which `console.timeStamp` lacks. So a fix in React 19.3 is an
expectation, not a promise — version claims prove nothing here; only the empirical
check below does.

## Decision

No code workaround — the app stays clean and dev tabs get hard-refreshed manually
(and closed, not just reloaded, when multi-GB). The rejected alternative, kept in case
the decision flips: a dev-only sweeper in `src/main.tsx`, cheap and effective, at the
cost of shipping tooling-bug residue in app code and nuking any future first-party
marks/measures:

```ts
if (import.meta.env.DEV) {
  setInterval(() => {
    performance.clearMeasures()
    performance.clearMarks()
  }, 10_000)
}
```

## Verifying the fix on upgrade

On any react-dom bump (especially ≥ 19.3.0):

1. `pnpm dev`, open the app, let the book stream for ~2 minutes.
2. In the console: `performance.getEntriesByType("measure").length`.
   - **Flat / near-zero** → fixed. Mark this doc resolved (top status line) and drop
     the README + feature-CLAUDE.md pointers.
   - **Steadily climbing** ⚛/zero-width-space-named entries → still live; keep the
     hard-refresh policy.
3. Optional process-side confirmation: find the tab's renderer PID (Chrome ⋮ → More
   tools → Task Manager) and watch `footprint <pid>` / `ps -o rss= -p <pid>` stay flat.

As a negative control, the same two-minute check against `pnpm preview` stays at ~0
entries on 19.2.8.
