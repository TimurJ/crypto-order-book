// Latches the mid's last move direction; a null mid wipes the memory. Render-pure (../CLAUDE.md).

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
