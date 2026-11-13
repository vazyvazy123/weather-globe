import { describe, expect, test } from "vitest"
import { CITIES, TIER_RADIUS_PX } from "../src/data/cities"
import { greatCircleKm } from "../src/geo/distance"
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
      expect([1, 2, 3, 4], c.id).toContain(c.tier)
    }
  })

  test("many cities, the whole globe still readable at first sight: more show the bigger the globe is drawn", () => {
    expect(CITIES.length).toBeGreaterThan(200)
    expect(TIER_RADIUS_PX[1]).toBe(0)
    expect(TIER_RADIUS_PX[1]).toBeLessThan(TIER_RADIUS_PX[2])
    expect(TIER_RADIUS_PX[2]).toBeLessThan(TIER_RADIUS_PX[3])
    expect(TIER_RADIUS_PX[3]).toBeLessThan(TIER_RADIUS_PX[4])
  })

  test("zoomed out, only the best-known few, spread so that none crowds another even on a phone", () => {
    const top = CITIES.filter((c) => c.tier === 1)
    expect(top.length).toBeGreaterThanOrEqual(16)
    expect(top.length).toBeLessThanOrEqual(26)
    for (const a of top) {
      for (const b of top) if (a !== b) expect(greatCircleKm(a.lat, a.lon, b.lat, b.lon), `${a.id}–${b.id}`).toBeGreaterThan(1000)
    }
    // every inhabited continent has one
    const has = (lat0: number, lat1: number, lon0: number, lon1: number) => top.some((c) => c.lat >= lat0 && c.lat <= lat1 && c.lon >= lon0 && c.lon <= lon1)
    expect(has(15, 70, -170, -50)).toBe(true) // North America
    expect(has(-60, 12, -90, -30)).toBe(true) // South America
    expect(has(35, 70, -12, 45)).toBe(true) // Europe
    expect(has(-35, 35, -20, 52)).toBe(true) // Africa
    expect(has(0, 60, 60, 150)).toBe(true) // Asia
    expect(has(-50, -10, 110, 180)).toBe(true) // Oceania
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
