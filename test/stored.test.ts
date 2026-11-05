import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { store, stored } from "../src/data/throttle"
import { pngSize } from "../src/globe/satDecode"

describe("values kept in localStorage", () => {
  beforeEach(() => {
    const kept = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => { kept.set(k, v) },
      removeItem: (k: string) => { kept.delete(k) },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test("a value comes back with the time it was stored", () => {
    const at = Date.now() - 1000
    store("k", { a: 1 }, at)
    expect(stored<{ a: number }>("k")).toEqual({ atMs: at, value: { a: 1 } })
  })

  test("one stored in the future (a clock that was ahead) is not trusted: it would look fresh for ever", () => {
    store("k", 1, Date.now() + 3_600_000)
    expect(stored("k")).toBeNull()
  })

  test("one that is not what is asked for (old or damaged) is left unread", () => {
    store("k", { line1: 3 }, Date.now())
    expect(stored("k", (v) => typeof (v as { line1?: unknown }).line1 === "string")).toBeNull()
    localStorage.setItem("k", "not json")
    expect(stored("k")).toBeNull()
  })
})

describe("a PNG's size, read from its header before it is decoded", () => {
  const header = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    const v = new DataView(b.buffer)
    v.setUint32(16, w)
    v.setUint32(20, h)
    return b
  }

  test("is its IHDR's width and height", () => {
    expect(pngSize(header(4096, 1638))).toEqual({ w: 4096, h: 1638 })
  })

  test("is null for anything that is not a PNG", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(pngSize(new TextEncoder().encode("<html>an error page</html> and some more bytes"))).toBeNull()
  })
})
