import { describe, expect, test } from "vitest"
import { firstPassNear, groundTrack, issAt, orbitMinutes, parseTle } from "../src/geo/orbit"

// the ISS's elements as wheretheiss.at gave them on 2026-11-05, and where it said the ISS was at four moments then
const L1 = "1 25544U 98067A   26308.88559265  .00005352  00000+0  10457-3 0  9991"
const L2 = "2 25544  51.6327 323.8448 0007212 348.6490  11.4335 15.49180468593565"
const SEEN = [
  { t: 1793887876, lat: -17.521, lon: 48.321, alt: 418.9, v: 27586 },
  { t: 1793889676, lat: 51.611, lon: 151.539, alt: 426.2, v: 27581 },
  { t: 1793898676, lat: -33.735, lon: -14.747, alt: 425.6, v: 27569 },
  { t: 1793844676, lat: 46.506, lon: -58.244, alt: 422.9, v: 27590 },
]
const lonGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe("parseTle", () => {
  test("reads the epoch and the orbit's shape", () => {
    const el = parseTle(L1, L2)!
    expect(el.epochMs).toBeCloseTo(Date.UTC(2026, 0, 1) + 307.88559265 * 86_400_000, -1)
    expect(el.incl * (180 / Math.PI)).toBeCloseTo(51.6327, 4)
    expect(el.ecc).toBeCloseTo(0.0007212, 7)
    expect(orbitMinutes(el)).toBeCloseTo(92.95, 1)
  })

  test("refuses lines that are not a two-line element set", () => {
    expect(parseTle("hello", L2)).toBeNull()
    expect(parseTle(L2, L1)).toBeNull()
  })
})

describe("issAt", () => {
  const el = parseTle(L1, L2)!
  test.each(SEEN)("puts the ISS where it was seen at $t", (s) => {
    const p = issAt(el, s.t * 1000)
    expect(Math.abs(p.lat - s.lat)).toBeLessThan(0.3)
    expect(lonGap(p.lon, s.lon)).toBeLessThan(0.3)
    // (the height swings a few km more than this model has it: it leaves out J2's short-period terms)
    expect(Math.abs(p.altKm - s.alt)).toBeLessThan(10)
    expect(Math.abs(p.speedKmh - s.v)).toBeLessThan(40)
  })
})

describe("groundTrack", () => {
  test("follows the orbit, never past its inclination", () => {
    const el = parseTle(L1, L2)!, t0 = SEEN[0].t * 1000
    const track = groundTrack(el, t0, t0 + 92 * 60_000, 60_000)
    expect(track).toHaveLength(93)
    expect(Math.max(...track.map((p) => Math.abs(p.lat)))).toBeLessThan(52)
    expect(track[0].tMs).toBe(t0)
  })
})

describe("firstPassNear", () => {
  test("finds the first place the ISS goes over, at its closest", () => {
    const el = parseTle(L1, L2)!, t0 = SEEN[0].t * 1000
    const places = [{ id: "far", lat: 60, lon: 0 }, { id: "under", lat: -17.5, lon: 48.3 }]
    const pass = firstPassNear(el, t0 - 10 * 60_000, t0 + 10 * 60_000, places, 200)!
    expect(pass.id).toBe("under")
    expect(Math.abs(pass.atMs - t0)).toBeLessThan(60_000)
    expect(pass.km).toBeLessThan(40)
  })

  test("none where it goes over nowhere listed", () => {
    const el = parseTle(L1, L2)!, t0 = SEEN[0].t * 1000
    expect(firstPassNear(el, t0, t0 + 5 * 60_000, [{ id: "pole", lat: 89, lon: 0 }], 200)).toBeNull()
  })
})
