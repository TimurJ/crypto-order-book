// Direction memory for the spread row's mid price (design handoff: "▲ 68,418.00" in
// green after an up-move, red ▼ after a down-move). The view-model is deliberately pure,
// so the one piece of cross-commit memory the arrow needs — "which way did mid last
// move?" — lives here instead.
//
// Latching: an unchanged mid keeps the LAST direction (the arrow doesn't blink off
// between moves), and a null mid (empty/crossed book) both renders directionless and
// wipes the memory — direction resumes fresh once a mid exists again. Render purity is
// the same ref-committed-in-effect pattern as use-level-flashes.ts, so StrictMode's
// double render cannot double-apply a move.

import { useEffect, useRef } from "react"

export type MidDirection = "up" | "down"

export function useMidDirection(mid: number | null): MidDirection | null {
  const committed = useRef<{
    mid: number | null
    direction: MidDirection | null
  }>({ mid: null, direction: null })
  const prev = committed.current
  let direction: MidDirection | null
  if (mid === null) {
    direction = null
  } else if (prev.mid === null || mid === prev.mid) {
    direction = prev.direction
  } else {
    direction = mid > prev.mid ? "up" : "down"
  }
  useEffect(() => {
    committed.current = { mid, direction }
  })
  return direction
}
