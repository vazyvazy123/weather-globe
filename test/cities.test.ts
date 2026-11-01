import { describe, expect, test } from "vitest"
import { CITIES, TIER_ZOOM } from "../src/data/cities"
import { batches, CITY_BATCH } from "../src/data/weather"
import { packRadii } from "../src/ui/Cassette"

describe("the cities", () => {
  test("ids are unique and every city is well-formed", () => {
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length)
    for (const c of CITIES) {
      expect(c.lat, c.id).toBeGreaterThanOrEqual(-90)
      expect(c.lat, c.id).toBeLessThanOrEqual(90)
      expect(c.lon, c.id).toBeGreaterThanOrEqual(-180)
      expect(c.lon, c.id).toBeLessThanOrEqual(180)
      expect(c.country, c.id).toMatch(/^[A-Z]{2}$/)
      expect([1, 2, 3], c.id).toContain(c.tier)
    }
  })

  test("many cities, the whole globe still readable at first sight", () => {
    expect(CITIES.length).toBeGreaterThan(200)
    expect(CITIES.filter((c) => c.tier === 1).length).toBeLessThan(70)
    expect(TIER_ZOOM[1]).toBeLessThan(TIER_ZOOM[2])
    expect(TIER_ZOOM[2]).toBeLessThan(TIER_ZOOM[3])
  })

  test("the weather reads them in a few batches, none too long, losing none", () => {
    const parts = batches(CITIES, CITY_BATCH)
    expect(parts.length).toBe(Math.ceil(CITIES.length / CITY_BATCH))
    expect(parts.every((p) => p.length <= CITY_BATCH)).toBe(true)
    expect(parts.flat()).toEqual(CITIES)
    expect(batches([], 10)).toEqual([])
  })
})

describe("the cassette", () => {
  test("the tape moves from the left pack to the right, its total area kept", () => {
    const [l0, r0] = packRadii(0), [l1, r1] = packRadii(1), [lh, rh] = packRadii(0.5)
    expect(l0).toBeCloseTo(r1)
    expect(r0).toBeCloseTo(l1)
    expect(lh).toBeCloseTo(rh)
    for (const p of [0, 0.3, 0.7, 1]) {
      const [l, r] = packRadii(p)
      expect(l * l + r * r).toBeCloseTo(l0 * l0 + r0 * r0)
    }
    expect(packRadii(-1)).toEqual(packRadii(0))
    expect(packRadii(2)).toEqual(packRadii(1))
  })
})
