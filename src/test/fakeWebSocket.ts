// Hand-rolled WebSocket double shared by the connection-stack suites (ws-transport,
// order-book-sync). Deliberately not MSW: these tests need exact control over event
// timing and ordering, which a network-layer interceptor can't give. Stub it per-suite
// with vi.stubGlobal("WebSocket", FakeWebSocket) and reset `instances` in afterEach.

import { vi } from "vitest"

export type FakeEvent = { data?: string }
type FakeHandler = (event: FakeEvent) => void

export class FakeWebSocket {
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

export const socketAt = (index: number): FakeWebSocket => {
  const socket = FakeWebSocket.instances[index]
  if (!socket) {
    throw new Error(`no FakeWebSocket at index ${index}`)
  }
  return socket
}
