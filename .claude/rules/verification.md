# Verification

Positive tests cannot find negative-path gaps by construction. The TanStack Query / health layer passed
`pnpm build`, 46 tests, live curls, and `/simplify` — and a later review still found 6 correctness bugs.
Every check had asserted that what was built works; none probed outside it.

- **New route:** check what adjacent and unmatched paths return, not just the route itself — an unmatched
  `/api/*` was serving `index.html` at 200 via the SPA fallback.
- **Parser or decoder:** feed it garbage and assert a *typed* failure — an unguarded `res.json()` threw a
  bare SyntaxError on a non-JSON 2xx body.
- **State display:** enumerate every reachable state combination — TanStack v5 keeps `data` alongside
  `error` after a failed background refetch, so they coexist.
- **Route with a local twin:** verify in *all* serving modes — `pnpm dev`, `pnpm preview`, and deployed.
  A dev-only middleware registration passed every check except the one mode nobody ran.
- **A new taxonomy** (retryable vs not, worker-territory vs not): enumerate real inputs against it before
  implementing, because code only handles what the vocabulary names — `ParseError` fit none of the locked
  "4xx / 5xx / network" categories.
- **A copied in-repo pattern is itself in scope for review.** "Consistent with existing code" is not a
  correctness defence; the copied `/config.js` middleware carried prefix-matching and missing-`nosniff`
  bugs forward.
- **A check that cannot fail is not a check.** Assert the expected count *before* a removal so its absence
  afterwards proves the removal rather than a typo'd pattern, and never let a summary line print from
  outside the loop that sets its flag — a `while` loop in a pipe runs in a subshell, so the flag never
  propagates.
- Do **not** auto-run or proactively push `/code-review` — it is token-expensive and the user triggers it
  as a conscious decision. These inline checks are the cheap substitute.
