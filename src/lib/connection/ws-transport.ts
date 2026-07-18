// App-generic reconnecting WebSocket transport: full-jitter exponential backoff,
// a connect timeout for hung handshakes, an opt-in staleness watchdog, and a
// subscribe/getState store shaped for React's useSyncExternalStore. No protocol
// knowledge — Binance specifics live in the order-book sync layer.
import { reportError } from "@/lib/report-error.ts"
import { fullJitterDelay } from "./backoff.ts"

export type WsTransportStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"

export interface WsTransportSnapshot {
  status: WsTransportStatus
  /** Increments on every (re)open — how subscribers detect reconnects. */
  openCount: number
}

export interface WsTransportOptions {
  url: string
  onMessage: (data: string) => void
  onOpen?: () => void
  baseDelayMs?: number
  maxDelayMs?: number
  /**
   * How long a handshake may sit in `connecting` before it's abandoned and
   * retried (default 10s) — the browser's own handshake timeout can take minutes.
   */
  connectTimeoutMs?: number
  /** Watchdog is off when absent — stream cadence is the caller's knowledge. */
  staleThresholdMs?: number
}

export interface WsTransport {
  connect: () => void
  /** Terminal — create a fresh transport to reconnect. */
  destroy: () => void
  subscribe: (listener: () => void) => () => void
  getState: () => WsTransportSnapshot
}

export function createWsTransport(options: WsTransportOptions): WsTransport {
  const {
    url,
    onMessage,
    onOpen,
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    connectTimeoutMs = 10_000,
    staleThresholdMs,
  } = options

  let status: WsTransportStatus = "idle"
  let openCount = 0
  let attempts = 0
  let lastMessageAt = 0
  let ws: WebSocket | null = null
  let staleTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  // Cached identity: useSyncExternalStore needs a stable reference between changes.
  let snapshot: WsTransportSnapshot = { status, openCount }
  const listeners = new Set<() => void>()

  const setStatus = (next: WsTransportStatus) => {
    status = next
    snapshot = { status, openCount }
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        // A throwing subscriber must not wedge a transition mid-flight.
        reportError(error, { source: "ws:transport" })
      }
    }
  }

  // Detach and reconnect now — waiting on the browser (a black-holed socket's
  // close, a hung handshake's timeout) can take minutes.
  const forceReconnect = () => {
    const socket = ws
    ws = null
    socket?.close()
    scheduleReconnect()
  }

  // One re-arming deadline instead of clear+set per message; performance.now()
  // because a wall-clock step would skew the deadline.
  const checkStale = () => {
    if (staleThresholdMs === undefined) return
    const elapsed = performance.now() - lastMessageAt
    if (elapsed >= staleThresholdMs) {
      forceReconnect()
    } else {
      staleTimer = setTimeout(checkStale, staleThresholdMs - elapsed)
    }
  }

  const scheduleReconnect = () => {
    const delay = fullJitterDelay(attempts, baseDelayMs, maxDelayMs)
    attempts += 1
    // Arm before notifying so a subscriber calling destroy() can still clear it.
    reconnectTimer = setTimeout(openSocket, delay)
    setStatus("reconnecting")
  }

  const openSocket = () => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      // The constructor can throw synchronously (e.g. mid page-unload) — fall
      // into backoff rather than dying uncaught inside a timer callback.
      reportError(error, { source: "ws:transport" })
      scheduleReconnect()
      return
    }
    ws = socket
    // Arm before the notify below so a subscriber calling destroy() can clear it.
    connectTimer = setTimeout(forceReconnect, connectTimeoutMs)
    setStatus("connecting")

    socket.addEventListener("open", () => {
      // socket !== ws means a superseded generation — its events are ignored.
      if (socket !== ws || status !== "connecting") return
      clearTimeout(connectTimer)
      openCount += 1
      if (staleThresholdMs !== undefined) {
        lastMessageAt = performance.now()
        staleTimer = setTimeout(checkStale, staleThresholdMs)
      }
      setStatus("open")
      // A subscriber may have destroyed the transport during the notify above.
      if (socket !== ws) return
      onOpen?.()
    })

    socket.addEventListener("message", (event) => {
      if (socket !== ws || status !== "open") return
      // Backoff resets once the connection proves healthy, not merely on open.
      attempts = 0
      lastMessageAt = performance.now()
      onMessage(event.data)
    })

    socket.addEventListener("close", () => {
      if (socket !== ws || status === "closed") return
      clearTimeout(connectTimer)
      clearTimeout(staleTimer)
      scheduleReconnect()
    })

    socket.addEventListener("error", () => {
      if (socket !== ws || status === "closed") return
      reportError(new Error("WebSocket transport error"), {
        source: "ws:transport",
      })
    })
  }

  return {
    connect: () => {
      if (status !== "idle") return
      openSocket()
    },
    destroy: () => {
      if (status === "closed") return
      clearTimeout(staleTimer)
      clearTimeout(reconnectTimer)
      clearTimeout(connectTimer)
      // Detach before notify/close so late events and reentrant calls see a
      // dead generation.
      const socket = ws
      ws = null
      setStatus("closed")
      socket?.close()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => snapshot,
  }
}
