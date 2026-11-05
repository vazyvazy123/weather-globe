import { describe, expect, test } from "vitest"
import { landPathData, unwrapRing, wrapShifts } from "../src/globe/landMask"
import { WORLD_LAND_FINE } from "../src/geo/worldLandFine"
import { WORLD_LAND } from "../src/geo/worldLand"

describe("unwrapRing", () => {
  test("a ring crossing the date line gets continuous longitudes", () => {
    const { pts, turns } = unwrapRing([170, 0, -170, 0, -170, 10, 170, 10, 170, 0])
    expect(pts).toEqual([170, 0, 190, 0, 190, 10, 170, 10, 170, 0])
    expect(turns).toBe(0)
  })

  test("a ring circling a pole counts one turn", () => {
    const { turns } = unwrapRing([-180, -80, -90, -80, 0, -80, 90, -80, 180, -80])
    expect(Math.abs(turns)).toBe(1)
  })

  test("an ordinary ring is left as it is", () => {
    const ring = [0, 0, 10, 0, 10, 10, 0, 0]
    expect(unwrapRing(ring)).toEqual({ pts: ring, turns: 0 })
  })
})

describe("the land data", () => {
  test("every ring is a flat list of valid lon, lat pairs", () => {
    for (const set of [WORLD_LAND, WORLD_LAND_FINE]) {
      expect(set.length).toBeGreaterThan(100)
      for (const ring of set) {
        expect(ring.length % 2).toBe(0)
        for (let i = 0; i < ring.length; i += 2) {
          expect(Math.abs(ring[i])).toBeLessThanOrEqual(180)
          expect(Math.abs(ring[i + 1])).toBeLessThanOrEqual(90)
        }
      }
    }
  })

  test("exactly the rings that circle a pole are Antarctica's", () => {
    const polar = WORLD_LAND_FINE.filter((r) => unwrapRing(r).turns !== 0)
    expect(polar.length).toBeGreaterThan(0)
    for (const r of polar) {
      let sum = 0
      for (let i = 1; i < r.length; i += 2) sum += r[i]
      expect(sum / (r.length / 2)).toBeLessThan(-60)
    }
  })
})

describe("wrapShifts", () => {
  const box = (w: number, e: number) => [w, 0, e, 0, e, 10, w, 10, w, 0]

  test("a ring far from the date line is drawn once", () => {
    expect(wrapShifts(box(-10, 30))).toEqual([0])
  })

  test("one near it is drawn a turn over too, where its blur crosses to the other edge", () => {
    expect(wrapShifts(box(165, 179))).toEqual([0, -360])
    expect(wrapShifts(box(-179, -165))).toEqual([0, 360])
    expect(wrapShifts(unwrapRing(box(170, -170)).pts)).toEqual([0, -360])
  })

  test("most of the world's rings are drawn once (each was drawn three times)", () => {
    const copies = WORLD_LAND_FINE.reduce((n, r) => n + wrapShifts(unwrapRing(r).pts).length - 1, 0)
    expect(copies).toBeLessThan(WORLD_LAND_FINE.length / 5)
  })
})

describe("landPathData", () => {
  test("is each ring once in the mask's pixels, closed, and a turn over where it nears the date line", () => {
    expect(landPathData([[0, 0, 90, 0, 90, 45, 0, 0]])).toBe("M2048.0 1024.0L3072.0 1024.0L3072.0 512.0L2048.0 1024.0Z")
    expect(landPathData([[170, 0, 179, 0, 179, 10, 170, 0]]).match(/M/g)).toHaveLength(2)
  })
})
