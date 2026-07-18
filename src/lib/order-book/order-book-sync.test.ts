import { FakeWebSocket, socketAt } from "@/test/fake-web-socket.ts"
import { silenceConsoleError } from "@/test/silence-console-error.ts"
import type { OrderBookSync, OrderBookSyncOptions } from "./order-book-sync.ts"
import { createOrderBookSync } from "./order-book-sync.ts"

type Level = [string, string]

const frame = (
  U: number,
  u: number,
  b: Level[] = [],
  a: Level[] = []
): string =>
  JSON.stringify({ e: "depthUpdate", E: 1, s: "BTCUSDT", U, u, b, a })

const snapshotBody = (
  lastUpdateId: number,
  bids: Level[] = [],
  asks: Level[] = []
) => ({ lastUpdateId, bids, asks })

interface PendingFetch {
  url: string
  aborted: boolean
  resolveWith: (init: { status?: number; body?: unknown }) => void
  rejectWith: (error: unknown) => void
}

const pendingFetches: PendingFetch[] = []

// Deferred-based fetch double: each call parks until the test resolves it, so the
// buffering-while-snapshot-pending phases are driven explicitly. Plain response-shaped
// objects (not real Responses) keep the microtask hops minimal under fake timers.
const stubFetch = ({ honorAbort = true } = {}) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string | URL, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          const pending: PendingFetch = {
            url: String(url),
            aborted: false,
            resolveWith: ({ status = 200, body }) =>
              resolve({
                ok: status >= 200 && status < 300,
                status,
                statusText: "",
                url: "",
                json: () => Promise.resolve(body),
              }),
            rejectWith: reject,
          }
          init?.signal?.addEventListener("abort", () => {
            pending.aborted = true
            if (honorAbort) reject(new DOMException("Aborted", "AbortError"))
          })
          pendingFetches.push(pending)
        })
    )
  )
}

const fetchAt = (index: number): PendingFetch => {
  const pending = pendingFetches[index]
  if (!pending) {
    throw new Error(`no pending fetch at index ${index}`)
  }
  return pending
}

// Yields to the microtask chain behind a resolved deferred (fake timers don't).
const flush = () => vi.advanceTimersByTimeAsync(0)

const engines: OrderBookSync[] = []

const createEngine = (overrides: Partial<OrderBookSyncOptions> = {}) => {
  const engine = createOrderBookSync({
    symbol: "BTCUSDT",
    wsBaseUrl: "wss://data-stream.test",
    restBaseUrl: "https://data-api.test",
    ...overrides,
  })
  engines.push(engine)
  return engine
}

// start() → open the socket → resolve the first snapshot → "live" at `lastUpdateId`.
const startLive = async (engine: OrderBookSync, lastUpdateId: number) => {
  engine.start()
  socketAt(0).simulateOpen()
  fetchAt(0).resolveWith({ body: snapshotBody(lastUpdateId) })
  await flush()
  expect(engine.getState().status).toBe("live")
}

describe("createOrderBookSync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeWebSocket)
    stubFetch()
    // Half-window jitter makes the expected retry delays (250, 500, …) exact.
    vi.spyOn(Math, "random").mockReturnValue(0.5)
  })

  afterEach(() => {
    for (const engine of engines) {
      engine.destroy()
    }
    engines.length = 0
    pendingFetches.length = 0
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
    FakeWebSocket.instances = []
  })

  it("syncs per the spec: buffer → snapshot → discard covered → apply → live", async () => {
    const engine = createEngine()
    engine.start()
    expect(engine.getState().status).toBe("connecting")
    expect(socketAt(0).url).toBe(
      "wss://data-stream.test/ws/btcusdt@depth@100ms"
    )

    socketAt(0).simulateOpen()
    expect(engine.getState().status).toBe("syncing")
    expect(fetchAt(0).url).toBe(
      "https://data-api.test/api/v3/depth?symbol=BTCUSDT&limit=5000"
    )

    // Buffered while the snapshot is in flight; the first is fully covered by it,
    // the second OVERLAPS the snapshot (U=103 <= id+1 <= u) — applies safely because
    // quantities are absolute.
    socketAt(0).simulateMessage(frame(101, 102, [["100.00", "9.9"]]))
    socketAt(0).simulateMessage(frame(103, 105, [["100.00", "6.0"]]))
    socketAt(0).simulateMessage(
      frame(106, 110, [["100.00", "0"]], [["101.00", "1.0"]])
    )

    fetchAt(0).resolveWith({
      body: snapshotBody(103, [["100.00", "5.0"]], [["100.50", "2.0"]]),
    })
    await flush()

    const state = engine.getState()
    expect(state.status).toBe("live")
    expect(state.lastUpdateId).toBe(110)
    // 100.00 was set by the snapshot, overridden by event 2, removed by event 3;
    // event 1 (u=102 < snapshot id) was discarded, so "9.9" never applied.
    expect(state.bids.size).toBe(0)
    expect(state.asks).toEqual(
      new Map([
        ["100.50", "2.0"],
        ["101.00", "1.0"],
      ])
    )
    expect(state.droppedFrames).toBe(0)
    expect(state.resyncCount).toBe(0)
  })

  it("refetches after backoff when the snapshot predates the buffered stream", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()
    socketAt(0).simulateMessage(frame(200, 205, [["1.00", "1"]]))

    // REST replica lagging: snapshot older than the first buffered update.
    fetchAt(0).resolveWith({ body: snapshotBody(150) })
    await flush()
    expect(engine.getState().status).toBe("syncing")
    expect(pendingFetches).toHaveLength(1)

    // Full-jitter retry: 0.5 * min(10_000, 500 * 2^0) = 250ms.
    await vi.advanceTimersByTimeAsync(249)
    expect(pendingFetches).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(pendingFetches).toHaveLength(2)

    fetchAt(1).resolveWith({ body: snapshotBody(204) })
    await flush()
    expect(engine.getState().status).toBe("live")
    expect(engine.getState().lastUpdateId).toBe(205)
  })

  it("applies absolute quantities: zero removes, absent removal is a no-op", async () => {
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()
    fetchAt(0).resolveWith({
      body: snapshotBody(100, [
        ["10.00", "1.0"],
        ["11.00", "2.0"],
      ]),
    })
    await flush()

    socketAt(0).simulateMessage(
      frame(101, 101, [
        ["10.00", "0.00000000"],
        ["12.00", "0.00000000"],
      ])
    )

    expect(engine.getState().bids).toEqual(new Map([["11.00", "2.0"]]))
    expect(engine.getState().lastUpdateId).toBe(101)
  })

  it("resyncs in place on a live continuity gap, seeding the gap event", async () => {
    const errorSpy = silenceConsoleError()
    const engine = createEngine()
    await startLive(engine, 100)

    socketAt(0).simulateMessage(frame(105, 106, [["10.00", "1.0"]]))

    expect(engine.getState().status).toBe("syncing")
    expect(errorSpy).toHaveBeenCalled()
    expect(pendingFetches).toHaveLength(2)
    // The socket was never touched — in-place recovery.
    expect(socketAt(0).close).not.toHaveBeenCalled()

    // Snapshot reaches the gap event's U (the spec's step-4 check needs
    // lastUpdateId >= first buffered U); the seeded event overlaps and applies.
    fetchAt(1).resolveWith({ body: snapshotBody(105) })
    await flush()

    const state = engine.getState()
    expect(state.status).toBe("live")
    expect(state.lastUpdateId).toBe(106)
    expect(state.bids).toEqual(new Map([["10.00", "1.0"]]))
    expect(state.resyncCount).toBe(1)
  })

  it("ignores stale events (u < book id) without committing or resyncing", async () => {
    const engine = createEngine()
    await startLive(engine, 100)
    const before = engine.getState()

    socketAt(0).simulateMessage(frame(90, 95, [["1.00", "1"]]))

    expect(engine.getState()).toBe(before)
    expect(pendingFetches).toHaveLength(1)
  })

  it("drops a malformed frame and keeps applying when no gap results", async () => {
    const errorSpy = silenceConsoleError()
    const engine = createEngine()
    await startLive(engine, 100)

    socketAt(0).simulateMessage("{ definitely not a depth frame")
    expect(engine.getState().droppedFrames).toBe(1)
    expect(errorSpy).toHaveBeenCalled()

    socketAt(0).simulateMessage(frame(101, 102, [["10.00", "1.0"]]))
    expect(engine.getState().status).toBe("live")
    expect(engine.getState().lastUpdateId).toBe(102)
    // No resync happened — the dropped garbage didn't break continuity.
    expect(pendingFetches).toHaveLength(1)
  })

  it("self-heals when a dropped frame did break continuity", async () => {
    silenceConsoleError()
    const engine = createEngine()
    await startLive(engine, 100)

    // The frame carrying updates 101-102 arrives corrupted and is dropped…
    socketAt(0).simulateMessage('{"e":"depthUpdate","u":"broken"}')
    expect(engine.getState().droppedFrames).toBe(1)

    // …so the next frame trips the gap check and forces a resync.
    socketAt(0).simulateMessage(frame(103, 104))
    expect(engine.getState().status).toBe("syncing")
    expect(pendingFetches).toHaveLength(2)
  })

  it("resyncs automatically after a transport reconnect and blocks the dead socket", async () => {
    const engine = createEngine()
    await startLive(engine, 100)

    socketAt(0).simulateClose()
    expect(engine.getState().status).toBe("connecting")

    // Late frames from the dead socket are dropped by the transport's guard.
    socketAt(0).simulateMessage(frame(101, 102, [["66.00", "6.6"]]))
    expect(engine.getState().bids.has("66.00")).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()
    expect(engine.getState().status).toBe("syncing")

    fetchAt(1).resolveWith({ body: snapshotBody(200, [["20.00", "2.0"]]) })
    await flush()

    const state = engine.getState()
    expect(state.status).toBe("live")
    expect(state.lastUpdateId).toBe(200)
    expect(state.bids).toEqual(new Map([["20.00", "2.0"]]))
    expect(state.resyncCount).toBe(1)
  })

  it("discards a superseded snapshot via the generation guard", async () => {
    // honorAbort: false models a fetch that ignores its AbortSignal — the guard
    // alone must prevent the stale snapshot from corrupting state.
    vi.unstubAllGlobals()
    vi.stubGlobal("WebSocket", FakeWebSocket)
    stubFetch({ honorAbort: false })

    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()
    expect(pendingFetches).toHaveLength(1)

    // Reconnect supersedes the in-flight attempt.
    socketAt(0).simulateClose()
    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()
    expect(pendingFetches).toHaveLength(2)

    // The stale snapshot resolves late with conflicting data — must be ignored.
    fetchAt(0).resolveWith({ body: snapshotBody(999, [["9.99", "9.9"]]) })
    await flush()
    expect(engine.getState().status).toBe("syncing")
    expect(engine.getState().lastUpdateId).toBe(0)

    fetchAt(1).resolveWith({ body: snapshotBody(50, [["5.00", "5.0"]]) })
    await flush()
    expect(engine.getState().lastUpdateId).toBe(50)
    expect(engine.getState().bids).toEqual(new Map([["5.00", "5.0"]]))
  })

  it("aborts the in-flight snapshot on destroy and stays silent", async () => {
    const errorSpy = silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()
    expect(fetchAt(0).aborted).toBe(false)

    engine.destroy()

    expect(engine.getState().status).toBe("destroyed")
    expect(fetchAt(0).aborted).toBe(true)
    expect(socketAt(0).close).toHaveBeenCalled()
    await flush()
    // An intentional abort is not an error — nothing may be reported.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("retries after an HTTP failure and recovers", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()

    fetchAt(0).resolveWith({ status: 500, body: { code: -1000, msg: "boom" } })
    await flush()
    expect(engine.getState().status).toBe("syncing")

    await vi.advanceTimersByTimeAsync(250)
    fetchAt(1).resolveWith({ body: snapshotBody(10) })
    await flush()
    expect(engine.getState().status).toBe("live")
  })

  it("waits at least the rate-limit floor after a 429", async () => {
    silenceConsoleError()
    // A silent 30s socket would (rightly) trip the 10s watchdog and supersede the
    // retry — a real stream feeds it 10 frames/s. Widen it to isolate the floor.
    const engine = createEngine({ staleThresholdMs: 60_000 })
    engine.start()
    socketAt(0).simulateOpen()

    fetchAt(0).resolveWith({ status: 429, body: { code: -1003, msg: "waf" } })
    await flush()

    await vi.advanceTimersByTimeAsync(29_999)
    expect(pendingFetches).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(pendingFetches).toHaveLength(2)
  })

  it("turns degraded after three failures, keeps retrying, and recovers fully", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()

    // Failures 1-3 at jittered delays 250, 500, 1000.
    fetchAt(0).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("syncing")
    await vi.advanceTimersByTimeAsync(250)
    fetchAt(1).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("syncing")
    await vi.advanceTimersByTimeAsync(500)
    fetchAt(2).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("degraded")

    // Degraded is advisory — the retry loop keeps going and success goes straight live.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pendingFetches).toHaveLength(4)
    fetchAt(3).resolveWith({ body: snapshotBody(10) })
    await flush()
    expect(engine.getState().status).toBe("live")

    // The failure counter reset: a single new failure is not degraded again.
    socketAt(0).simulateMessage(frame(100, 101))
    expect(engine.getState().status).toBe("syncing")
    fetchAt(4).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("syncing")
  })

  it("restarts the attempt when the buffer overflows, without losing continuity", async () => {
    silenceConsoleError()
    const engine = createEngine({ bufferLimit: 3 })
    engine.start()
    socketAt(0).simulateOpen()

    socketAt(0).simulateMessage(frame(101, 110))
    socketAt(0).simulateMessage(frame(111, 120))
    socketAt(0).simulateMessage(frame(121, 130))
    // Fourth frame overflows: the attempt is abandoned, the frame seeds the next buffer.
    socketAt(0).simulateMessage(frame(131, 140, [["10.00", "1.0"]]))

    expect(fetchAt(0).aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(pendingFetches).toHaveLength(2)

    // Snapshot overlapping the seeded frame (lastUpdateId >= its U, per the spec's
    // step-4 check) proves the continuity survived the overflow.
    fetchAt(1).resolveWith({ body: snapshotBody(131) })
    await flush()

    const state = engine.getState()
    expect(state.status).toBe("live")
    expect(state.lastUpdateId).toBe(140)
    expect(state.bids).toEqual(new Map([["10.00", "1.0"]]))
  })

  it("recovers end-to-end when the stale watchdog kills a silent connection", async () => {
    const engine = createEngine()
    await startLive(engine, 100)

    // 10s of silence → the engine-armed watchdog force-closes the socket.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(socketAt(0).close).toHaveBeenCalled()
    expect(engine.getState().status).toBe("connecting")

    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()
    fetchAt(1).resolveWith({ body: snapshotBody(300) })
    await flush()

    expect(engine.getState().status).toBe("live")
    expect(engine.getState().lastUpdateId).toBe(300)
    expect(engine.getState().resyncCount).toBe(1)
  })

  it("keeps the snapshot identity stable between commits and shares the Maps", async () => {
    const engine = createEngine()
    await startLive(engine, 100)

    const before = engine.getState()
    expect(engine.getState()).toBe(before)

    socketAt(0).simulateMessage(frame(101, 102, [["10.00", "1.0"]]))

    const after = engine.getState()
    expect(after).not.toBe(before)
    expect(after.lastUpdateId).toBe(102)
    // The Maps are shared by reference (zero-copy store contract) — the NEW snapshot
    // identity is what signals the change to useSyncExternalStore.
    expect(after.bids).toBe(before.bids)
  })

  it("is single-use: start() twice is a no-op and destroy() is terminal", async () => {
    const engine = createEngine()
    engine.start()
    engine.start()
    expect(FakeWebSocket.instances).toHaveLength(1)

    engine.destroy()
    engine.start()
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("keeps degraded through a transport reconnect until a sync completes", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()

    // Three failures → degraded.
    fetchAt(0).resolveWith({ status: 500 })
    await flush()
    await vi.advanceTimersByTimeAsync(250)
    fetchAt(1).resolveWith({ status: 500 })
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    fetchAt(2).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("degraded")

    // Socket drops mid-degraded: status must stay degraded, not flip to "connecting".
    socketAt(0).simulateClose()
    expect(engine.getState().status).toBe("degraded")

    // …and the reopen's resync must not flash "syncing" either.
    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()
    expect(engine.getState().status).toBe("degraded")

    // Only a completed sync clears it.
    fetchAt(3).resolveWith({ body: snapshotBody(10) })
    await flush()
    expect(engine.getState().status).toBe("live")
  })

  it("latches degraded on cumulative failures across a reconnect but keeps backoff per-dance", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()

    // Two failures — one short of the degraded threshold.
    fetchAt(0).resolveWith({ status: 500 })
    await flush()
    await vi.advanceTimersByTimeAsync(250)
    fetchAt(1).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("syncing")

    // A reconnect starts a fresh dance. The per-dance BACKOFF counter resets…
    socketAt(0).simulateClose()
    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()

    // …but the degraded latch tracks failures-since-last-sync, which persists across the
    // reconnect: the third cumulative failure (no successful sync between) latches "degraded".
    fetchAt(2).resolveWith({ status: 500 })
    await flush()
    expect(engine.getState().status).toBe("degraded")

    // Backoff still reset per dance: the next retry fires at the base 250ms delay
    // (failedAttempts=1), not the ~1000ms a carried-over count would produce.
    await vi.advanceTimersByTimeAsync(250)
    expect(pendingFetches).toHaveLength(4)
  })

  it("stitches a snapshot whose lastUpdateId is exactly one before the first buffered U", async () => {
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()
    socketAt(0).simulateMessage(frame(200, 205, [["1.00", "1"]]))

    // The overlap boundary: lastUpdateId == first buffered U - 1 (199 vs 200). applyEvent
    // accepts U <= lastUpdateId + 1, so it stitches in place — no needless refetch.
    fetchAt(0).resolveWith({ body: snapshotBody(199) })
    await flush()

    const state = engine.getState()
    expect(state.status).toBe("live")
    expect(state.lastUpdateId).toBe(205)
    expect(state.bids).toEqual(new Map([["1.00", "1"]]))
    expect(pendingFetches).toHaveLength(1)
  })

  it("drops a frame carrying a non-numeric price level", async () => {
    silenceConsoleError()
    const engine = createEngine()
    await startLive(engine, 100)

    socketAt(0).simulateMessage(frame(101, 102, [["not-a-number", "1.0"]]))

    expect(engine.getState().droppedFrames).toBe(1)
    // The bad price never entered the book; the update was not applied.
    expect(engine.getState().bids.has("not-a-number")).toBe(false)
    expect(engine.getState().lastUpdateId).toBe(100)
  })

  it("commits the partial book when a gap surfaces during buffered replay", async () => {
    silenceConsoleError()
    const engine = createEngine()
    engine.start()
    socketAt(0).simulateOpen()

    // A malformed frame between two good ones is dropped (never buffered), so replaying the
    // buffer against the snapshot hits a real continuity gap partway through.
    socketAt(0).simulateMessage(frame(101, 105, [["10.00", "1.0"]]))
    socketAt(0).simulateMessage(frame(106, 110, [["not-a-number", "9"]]))
    socketAt(0).simulateMessage(frame(120, 125, [["11.00", "2.0"]]))

    // Snapshot at 100 stitches frame(101,105) but frame(120,125) gaps mid-drain.
    fetchAt(0).resolveWith({ body: snapshotBody(100) })
    await flush()

    // The gap re-dances, but the shared Maps already hold snapshot + pre-gap events — the
    // exposed snapshot must be committed to match (lastUpdateId 105, not the stale 0).
    const mid = engine.getState()
    expect(mid.status).toBe("syncing")
    expect(mid.lastUpdateId).toBe(105)
    expect(mid.bids).toEqual(new Map([["10.00", "1.0"]]))
    expect(mid.droppedFrames).toBe(1)

    // The re-dance stitches the seeded frame(120,125) and reaches live with the full book.
    fetchAt(1).resolveWith({ body: snapshotBody(120, [["10.00", "1.0"]]) })
    await flush()

    const live = engine.getState()
    expect(live.status).toBe("live")
    expect(live.lastUpdateId).toBe(125)
    expect(live.bids).toEqual(
      new Map([
        ["10.00", "1.0"],
        ["11.00", "2.0"],
      ])
    )
  })

  it("preserves the rate-limit floor across a transport reconnect", async () => {
    silenceConsoleError()
    // Widen the watchdog so 30s of silence doesn't force-close the socket mid-floor.
    const engine = createEngine({ staleThresholdMs: 120_000 })
    engine.start()
    socketAt(0).simulateOpen()

    // A 418 arms the >=30s rate-limit floor.
    fetchAt(0).resolveWith({
      status: 418,
      body: { code: -1003, msg: "banned" },
    })
    await flush()

    // The stream drops and reopens well inside the floor window. The reopen must NOT refetch
    // immediately — the floor lives in a deadline, not the retry timer the drop discarded.
    socketAt(0).simulateClose()
    await vi.advanceTimersByTimeAsync(500)
    socketAt(1).simulateOpen()
    await flush()
    expect(pendingFetches).toHaveLength(1)

    // Only once the floor elapses does the refetch fire.
    await vi.advanceTimersByTimeAsync(29_500)
    expect(pendingFetches).toHaveLength(2)
  })
})
