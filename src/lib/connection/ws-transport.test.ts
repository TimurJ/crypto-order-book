import type { WsTransport, WsTransportOptions } from "./ws-transport.ts"
import { createWsTransport } from "./ws-transport.ts"

type FakeEvent = { data?: string }
type FakeHandler = (event: FakeEvent) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  // Unlike a real socket, close() emits nothing — tests fire simulateClose()
  // where the browser would.
  readonly close = vi.fn()
  private handlers = new Map<string, FakeHandler[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: FakeHandler) {
    const list = this.handlers.get(type) ?? []
    list.push(handler)
    this.handlers.set(type, list)
  }

  private emit(type: string, event: FakeEvent = {}) {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event)
    }
  }

  simulateOpen() {
    this.emit("open")
  }

  simulateMessage(data: string) {
    this.emit("message", { data })
  }

  simulateClose() {
    this.emit("close")
  }

  simulateError() {
    this.emit("error")
  }
}

const socketAt = (index: number): FakeWebSocket => {
  const socket = FakeWebSocket.instances[index]
  if (!socket) {
    throw new Error(`no FakeWebSocket at index ${index}`)
  }
  return socket
}

const expectReconnectAfter = (delay: number, count: number) => {
  vi.advanceTimersByTime(delay - 1)
  expect(FakeWebSocket.instances).toHaveLength(count)
  vi.advanceTimersByTime(1)
  expect(FakeWebSocket.instances).toHaveLength(count + 1)
}

const expectForceCloseAfter = (
  transport: WsTransport,
  socket: FakeWebSocket,
  delay: number
) => {
  vi.advanceTimersByTime(delay - 1)
  expect(socket.close).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(socket.close).toHaveBeenCalledTimes(1)
  expect(transport.getState().status).toBe("reconnecting")
}

// Silences the console noise reportError emits on error-path tests.
const silenceConsoleError = () =>
  vi.spyOn(console, "error").mockImplementation(() => {})

// Fresh counter per call — a shared one would leave later tests throw-less.
const stubThrowingOnceWebSocket = () => {
  let constructions = 0
  class ThrowingOnceWebSocket extends FakeWebSocket {
    constructor(url: string) {
      constructions += 1
      if (constructions === 1) throw new Error("constructor refused")
      super(url)
    }
  }
  vi.stubGlobal("WebSocket", ThrowingOnceWebSocket)
}

// Destroyed in afterEach — tests shouldn't leak live transports.
const transports: WsTransport[] = []

const createTransport = (overrides: Partial<WsTransportOptions> = {}) => {
  const onMessage = vi.fn()
  const onOpen = vi.fn()
  const transport = createWsTransport({
    url: "wss://example.test/stream",
    onMessage,
    onOpen,
    ...overrides,
  })
  transports.push(transport)
  return { transport, onMessage, onOpen }
}

// With the default connect timeout, an unopened socket is an endless
// timeout→reconnect→timeout timer chain — never vi.runAllTimers() while one
// exists; use bounded advanceTimersByTime instead.
describe("createWsTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeWebSocket)
    // Half-window jitter makes the expected delays (500, 1000, …) exact.
    vi.spyOn(Math, "random").mockReturnValue(0.5)
  })

  afterEach(() => {
    for (const transport of transports) {
      transport.destroy()
    }
    transports.length = 0
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
    FakeWebSocket.instances = []
  })

  it("constructs a WebSocket with the url on connect()", () => {
    const { transport } = createTransport()
    expect(transport.getState().status).toBe("idle")

    transport.connect()

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socketAt(0).url).toBe("wss://example.test/stream")
    expect(transport.getState().status).toBe("connecting")

    transport.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("reports open and fires onOpen when the socket opens", () => {
    const { transport, onOpen } = createTransport()
    const listener = vi.fn()
    transport.subscribe(listener)

    transport.connect()
    socketAt(0).simulateOpen()

    expect(transport.getState()).toEqual({ status: "open", openCount: 1 })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalled()
  })

  it("passes raw message data through without changing the snapshot", () => {
    const { transport, onMessage } = createTransport()
    transport.connect()
    socketAt(0).simulateOpen()

    const before = transport.getState()
    socketAt(0).simulateMessage('{"payload":"opaque"}')

    expect(onMessage).toHaveBeenCalledWith('{"payload":"opaque"}')
    expect(transport.getState()).toBe(before)
  })

  it("returns a stable snapshot reference until state changes", () => {
    const { transport } = createTransport()
    transport.connect()

    const connecting = transport.getState()
    expect(transport.getState()).toBe(connecting)

    socketAt(0).simulateOpen()
    expect(transport.getState()).not.toBe(connecting)
  })

  it("does not reconnect when destroyed while still connecting", () => {
    const { transport } = createTransport()
    transport.connect()

    transport.destroy()

    expect(socketAt(0).close).toHaveBeenCalledTimes(1)
    expect(transport.getState().status).toBe("closed")

    socketAt(0).simulateClose()
    vi.runAllTimers()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("reconnects after the jittered backoff delay", () => {
    const { transport } = createTransport()
    transport.connect()
    socketAt(0).simulateOpen()

    socketAt(0).simulateClose()
    expect(transport.getState().status).toBe("reconnecting")

    expectReconnectAfter(500, 1)
    expect(transport.getState().status).toBe("connecting")
  })

  it("schedules exactly one reconnect when error and close both fire", () => {
    silenceConsoleError()
    const { transport } = createTransport()
    transport.connect()
    socketAt(0).simulateOpen()

    socketAt(0).simulateError()
    socketAt(0).simulateClose()
    // A double-scheduled reconnect would surface as a third socket by now.
    vi.advanceTimersByTime(9_000)

    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it("grows the backoff exponentially and caps it", () => {
    const { transport } = createTransport()
    transport.connect()

    const expectedDelays = [500, 1000, 2000, 4000, 8000, 15_000, 15_000]
    for (const [index, delay] of expectedDelays.entries()) {
      socketAt(index).simulateClose()
      expectReconnectAfter(delay, index + 1)
    }
  })

  it("resets backoff after a message proves the connection healthy", () => {
    const { transport } = createTransport()
    transport.connect()

    socketAt(0).simulateClose()
    vi.advanceTimersByTime(500)
    socketAt(1).simulateClose()
    vi.advanceTimersByTime(1000)

    socketAt(2).simulateOpen()
    socketAt(2).simulateMessage("healthy")
    socketAt(2).simulateClose()

    expectReconnectAfter(500, 3)
  })

  it("force-closes a stale connection and reconnects", () => {
    const { transport, onOpen } = createTransport({ staleThresholdMs: 10_000 })
    transport.connect()
    socketAt(0).simulateOpen()

    vi.advanceTimersByTime(9_999)
    expect(socketAt(0).close).not.toHaveBeenCalled()

    socketAt(0).simulateMessage("still alive")
    expectForceCloseAfter(transport, socketAt(0), 10_000)

    socketAt(0).simulateClose()
    expect(FakeWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(500)
    socketAt(1).simulateOpen()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it("leaves an open socket alone — connect timeout disarmed, no watchdog by default", () => {
    const { transport } = createTransport()
    transport.connect()
    socketAt(0).simulateOpen()

    vi.advanceTimersByTime(3_600_000)
    expect(socketAt(0).close).not.toHaveBeenCalled()
    expect(transport.getState().status).toBe("open")
  })

  it("does not fire the stale watchdog after destroy", () => {
    const { transport } = createTransport({ staleThresholdMs: 10_000 })
    transport.connect()
    socketAt(0).simulateOpen()

    transport.destroy()
    expect(socketAt(0).close).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(socketAt(0).close).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("stays destroyed when a subscriber destroys during reconnect", () => {
    const { transport } = createTransport()
    transport.subscribe(() => {
      if (transport.getState().status === "reconnecting") transport.destroy()
    })
    transport.connect()
    socketAt(0).simulateOpen()
    socketAt(0).simulateClose()

    expect(transport.getState().status).toBe("closed")
    vi.runAllTimers()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("keeps transitions intact when a subscriber throws", () => {
    const errorSpy = silenceConsoleError()
    const { transport } = createTransport()
    const second = vi.fn()
    transport.subscribe(() => {
      throw new Error("bad subscriber")
    })
    transport.subscribe(second)
    transport.connect()
    socketAt(0).simulateOpen()
    socketAt(0).simulateClose()

    expect(second).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    expect(transport.getState().status).toBe("reconnecting")
    expectReconnectAfter(500, 1)
  })

  it("does not fire onOpen when a subscriber destroys during open", () => {
    const { transport, onOpen } = createTransport()
    transport.subscribe(() => {
      if (transport.getState().status === "open") transport.destroy()
    })
    transport.connect()
    socketAt(0).simulateOpen()

    expect(onOpen).not.toHaveBeenCalled()
    expect(transport.getState().status).toBe("closed")
  })

  it("retries with backoff when the WebSocket constructor throws", () => {
    const errorSpy = silenceConsoleError()
    stubThrowingOnceWebSocket()

    const { transport } = createTransport()
    transport.connect()

    expect(errorSpy).toHaveBeenCalled()
    expect(transport.getState().status).toBe("reconnecting")
    expect(FakeWebSocket.instances).toHaveLength(0)

    vi.advanceTimersByTime(500)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(transport.getState().status).toBe("connecting")
  })

  it("signals every reopen and honors unsubscribe", () => {
    const { transport, onOpen } = createTransport()
    const listener = vi.fn()
    const unsubscribe = transport.subscribe(listener)

    transport.connect()
    socketAt(0).simulateOpen()
    socketAt(0).simulateClose()
    vi.advanceTimersByTime(500)
    socketAt(1).simulateOpen()

    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(transport.getState().openCount).toBe(2)

    unsubscribe()
    const notifications = listener.mock.calls.length
    socketAt(1).simulateClose()
    expect(listener.mock.calls.length).toBe(notifications)
  })

  it("ignores messages from a dead socket while reconnecting", () => {
    const { transport, onMessage } = createTransport()
    transport.connect()
    socketAt(0).simulateOpen()
    socketAt(0).simulateClose()
    expect(transport.getState().status).toBe("reconnecting")

    socketAt(0).simulateMessage("late")
    expect(onMessage).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    const second = socketAt(1)
    second.simulateOpen()
    second.simulateMessage("fresh")
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it("abandons a handshake that exceeds the connect timeout", () => {
    const { transport } = createTransport()
    transport.connect()

    expectForceCloseAfter(transport, socketAt(0), 10_000)

    // The browser's own late close on the abandoned socket is ignored.
    socketAt(0).simulateClose()
    expect(FakeWebSocket.instances).toHaveLength(1)

    expectReconnectAfter(500, 1)
  })

  it("honors a custom connectTimeoutMs", () => {
    const { transport } = createTransport({ connectTimeoutMs: 3_000 })
    transport.connect()

    expectForceCloseAfter(transport, socketAt(0), 3_000)
  })

  it("clears the connect timeout when the handshake is refused", () => {
    const { transport } = createTransport()
    transport.connect()

    socketAt(0).simulateClose()
    vi.advanceTimersByTime(500)
    const second = socketAt(1)
    second.simulateOpen()

    // A timer leaked from the refused socket would kill this healthy one at 10s.
    vi.advanceTimersByTime(10_000)
    expect(second.close).not.toHaveBeenCalled()
    expect(transport.getState().status).toBe("open")
  })

  it("grows the backoff across consecutive handshake timeouts", () => {
    const { transport } = createTransport()
    transport.connect()

    expectForceCloseAfter(transport, socketAt(0), 10_000)
    expectReconnectAfter(500, 1)

    expectForceCloseAfter(transport, socketAt(1), 10_000)
    expectReconnectAfter(1_000, 2)
  })

  it("arms no connect timeout when the constructor throws", () => {
    silenceConsoleError()
    stubThrowingOnceWebSocket()

    const { transport } = createTransport()
    transport.connect()

    vi.advanceTimersByTime(500)
    socketAt(0).simulateOpen()

    // A timer armed before the throwing constructor would kill this socket at 10s.
    vi.advanceTimersByTime(60_000)
    expect(socketAt(0).close).not.toHaveBeenCalled()
    expect(transport.getState().status).toBe("open")
  })

  it("stays destroyed when a subscriber destroys during connecting", () => {
    const { transport } = createTransport()
    transport.subscribe(() => {
      if (transport.getState().status === "connecting") transport.destroy()
    })
    transport.connect()

    expect(transport.getState().status).toBe("closed")
    vi.advanceTimersByTime(20_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(transport.getState().status).toBe("closed")
  })
})
