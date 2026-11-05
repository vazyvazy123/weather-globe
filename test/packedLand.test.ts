import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { packLand } from "../scripts/pack-land.mjs"
import { gunzip, unpackLand } from "../src/geo/packedLand"
import { WORLD_LAND_FINE } from "../src/geo/worldLandFine"
import { unwrapRing } from "../src/globe/landMask"

const PACKED = new URL("../src/geo/worldLandFine.bin", import.meta.url)

describe("packLand and unpackLand", () => {
  test("rings come back to within the grid they were packed on, still closed", () => {
    const rings = [
      [12.3456, -45.6789, 13.001, -45.2, 179.996, 0.004, -179.997, 89.996, 12.3456, -45.6789],
      [-0.0049, 0.0049, 0.5, 0.5, -0.0049, 0.0049],
    ]
    const back = unpackLand(packLand(rings, 100))
    expect(back).toHaveLength(rings.length)
    back.forEach((ring, r) => {
      expect(ring).toHaveLength(rings[r].length)
      ring.forEach((v, i) => expect(Math.abs(v - rings[r][i])).toBeLessThanOrEqual(0.005 + 1e-9))
      expect(ring.slice(-2)).toEqual(ring.slice(0, 2))
    })
  })

  test("points on the grid come back exactly, across the date line and at the poles", () => {
    const rings = [
      [179.98, -16.16, -179.98, -16.2, -179.9, -16.3, 179.98, -16.16],
      [-180, -90, 0, -84.5, 180, -90, -180, -90],
    ]
    expect(unpackLand(packLand(rings, 50))).toEqual(rings)
  })

  test("a ring that does not end where it starts, or a point off the globe, is refused", () => {
    expect(() => packLand([[0, 0, 1, 0, 1, 1]], 50)).toThrow(/closed/)
    expect(() => packLand([[0, 0, 200, 0, 0, 0]], 50)).toThrow(/not on the globe/)
    expect(() => packLand([[0, 0, Number.NaN, 0, 0, 0]], 50)).toThrow(/not on the globe/)
    expect(() => packLand([[0, 0, 1, 0, 0, 0]], 0)).toThrow(/steps/)
  })

  test("a file that is not a packed coastline is refused, not read as land", () => {
    expect(() => unpackLand(new TextEncoder().encode("<!doctype html><html>"))).toThrow(/not a packed coastline/)
    const whole = packLand(WORLD_LAND_FINE.slice(0, 3), 50)
    expect(() => unpackLand(whole.subarray(0, whole.length - 1))).toThrow(/ends early/)
    const longer = new Uint8Array(whole.length + 1)
    longer.set(whole)
    expect(() => unpackLand(longer)).toThrow(/left over/)
  })

  test("so is one whose numbers make no sense, without reading or holding much", () => {
    const file = (...rest: number[]) => Uint8Array.from([..."LAND"].map((c) => c.charCodeAt(0)).concat(rest))
    expect(() => unpackLand(file(2, 50, 0))).toThrow(/format 2/)
    expect(() => unpackLand(file(1, 0, 0))).toThrow(/no grid/)
    expect(() => unpackLand(file(1, 50, 1, 0))).toThrow(/empty ring/)
    expect(() => unpackLand(file(1, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f))).toThrow(/too long/)
    // a ring of 268 million points in a file of a few bytes
    expect(() => unpackLand(file(1, 50, 1, 0xff, 0xff, 0xff, 0x7f, 2, 4))).toThrow(/ends early/)
  })
})

describe("landRings", () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })
  /** the page's landRings, its memory of the coastline fresh */
  const freshLandRings = async () => (await import("../src/globe/landMask")).landRings

  test("fetches the packed coastline once, however often it is asked, and unpacks it", async () => {
    const fetched = vi.fn(async () => new Response(readFileSync(PACKED)))
    vi.stubGlobal("fetch", fetched)
    const landRings = await freshLandRings()
    const [a, b] = await Promise.all([landRings(), landRings()])
    expect(a).toEqual(WORLD_LAND_FINE)
    expect(await landRings()).toBe(a)
    expect(b).toBe(a)
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  test("an error answer, or a page in the file's place, fails, and the next ask fetches again", async () => {
    const answers = [new Response("gone", { status: 404 }), new Response("<!doctype html><html>"), new Response(readFileSync(PACKED))]
    const fetched = vi.fn(async () => answers.shift() ?? new Response(null, { status: 500 }))
    vi.stubGlobal("fetch", fetched)
    const landRings = await freshLandRings()
    await expect(landRings()).rejects.toThrow(/HTTP 404/)
    await expect(landRings()).rejects.toThrow()
    expect(await landRings()).toHaveLength(WORLD_LAND_FINE.length)
    expect(fetched).toHaveBeenCalledTimes(3)
  })
})

describe("the packed coastline the page reads", () => {
  test("is the fine coastline exactly: every ring and every point", async () => {
    const rings = unpackLand(await gunzip(readFileSync(PACKED)))
    expect(rings).toHaveLength(WORLD_LAND_FINE.length)
    expect(rings).toEqual(WORLD_LAND_FINE)
  })

  test("still has the rings that circle the south pole (Antarctica)", async () => {
    const rings = unpackLand(await gunzip(readFileSync(PACKED)))
    const polar = rings.filter((r) => unwrapRing(r).turns !== 0)
    expect(polar).toEqual(WORLD_LAND_FINE.filter((r) => unwrapRing(r).turns !== 0))
    expect(polar.length).toBeGreaterThan(0)
  })

  test("is under 80 KB: a third of the 225 KB the rings took written out as code (gzipped both)", () => {
    expect(readFileSync(PACKED).length).toBeLessThan(80_000)
  })
})
