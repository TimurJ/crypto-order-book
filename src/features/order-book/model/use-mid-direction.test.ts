import { renderHook } from "@testing-library/react"
import { StrictMode } from "react"
import { useMidDirection } from "./use-mid-direction.ts"

type Props = { mid: number | null }

describe("useMidDirection", () => {
  it("is null before any move — a first mid has no direction", () => {
    const { result, rerender } = renderHook(
      ({ mid }: Props) => useMidDirection(mid),
      { initialProps: { mid: null } as Props }
    )
    expect(result.current).toBeNull()
    rerender({ mid: 100.5 })
    expect(result.current).toBeNull()
  })

  it("reports up and down moves", () => {
    const { result, rerender } = renderHook(
      ({ mid }: Props) => useMidDirection(mid),
      { initialProps: { mid: 100.5 } as Props }
    )
    rerender({ mid: 101 })
    expect(result.current).toBe("up")
    rerender({ mid: 100 })
    expect(result.current).toBe("down")
  })

  it("latches the last direction while mid holds still", () => {
    const { result, rerender } = renderHook(
      ({ mid }: Props) => useMidDirection(mid),
      { initialProps: { mid: 100.5 } as Props }
    )
    rerender({ mid: 101 })
    rerender({ mid: 101 })
    rerender({ mid: 101 })
    expect(result.current).toBe("up")
  })

  it("goes directionless on a null mid and resumes fresh after", () => {
    const { result, rerender } = renderHook(
      ({ mid }: Props) => useMidDirection(mid),
      { initialProps: { mid: 100.5 } as Props }
    )
    rerender({ mid: 101 })
    expect(result.current).toBe("up")
    // Crossed/empty book: no mid, no arrow — and the memory is wiped.
    rerender({ mid: null })
    expect(result.current).toBeNull()
    // A returning mid is a fresh baseline, not a continuation.
    rerender({ mid: 99 })
    expect(result.current).toBeNull()
    rerender({ mid: 99.5 })
    expect(result.current).toBe("up")
  })

  it("does not double-apply a move under StrictMode's double render", () => {
    const { result, rerender } = renderHook(
      ({ mid }: Props) => useMidDirection(mid),
      { initialProps: { mid: 100.5 } as Props, wrapper: StrictMode }
    )
    rerender({ mid: 101 })
    expect(result.current).toBe("up")
    rerender({ mid: 101 })
    expect(result.current).toBe("up")
  })
})
