import { describe, expect, test } from "vitest"
import { CITIES } from "../src/data/cities"
import { parseIssTle } from "../src/data/iss"
import { TRACKS } from "../src/data/music"
import { OVER_KM, dayStartOf, songOfDay } from "../src/data/songOfDay"
import { EARTH_KM, greatCircleKm, smallCircle } from "../src/geo/distance"
import { WORLD_LAND } from "../src/geo/worldLand"
import { seaName, whereBelow } from "../src/geo/below"
import { issAt, parseTle } from "../src/geo/orbit"

const L1 = "1 25544U 98067A   26308.88559265  .00005352  00000+0  10457-3 0  9991"
const L2 = "2 25544  51.6327 323.8448 0007212 348.6490  11.4335 15.49180468593565"
const DAY = Date.UTC(2026, 10, 5)

describe("parseIssTle", () => {
  test("takes the two lines of wheretheiss.at's answer", () => {
    expect(parseIssTle({ id: "25544", line1: L1, line2: L2, header: "ISS (ZARYA)" })).toEqual({ line1: L1, line2: L2 })
  })

  test("refuses an answer whose lines are no elements", () => {
    expect(parseIssTle({ line1: "1 nope", line2: L2 })).toBeNull()
    expect(parseIssTle(null)).toBeNull()
  })
})

describe("dayStartOf", () => {
  test("the UTC midnight that opens the day", () => {
    expect(dayStartOf(DAY + 13 * 3600_000)).toBe(DAY)
  })
})

describe("songOfDay", () => {
  const el = parseTle(L1, L2)!

  test("the first place with songs the ISS flies over that day, and one of its own songs", () => {
    const pick = songOfDay(el, DAY, CITIES, TRACKS)!
    expect(pick).not.toBeNull()
    expect(pick.atMs).toBeGreaterThanOrEqual(DAY)
    expect(pick.atMs).toBeLessThan(DAY + 86_400_000)
    const s = issAt(el, pick.atMs)
    expect(greatCircleKm(s.lat, s.lon, pick.city.lat, pick.city.lon)).toBeLessThan(OVER_KM)
    expect(pick.track.city).toBe(pick.city.id)
  })

  test("the same day picks the same song; the next day, likely another", () => {
    const a = songOfDay(el, DAY, CITIES, TRACKS)!, b = songOfDay(el, DAY, CITIES, TRACKS)!
    expect(b.track.id).toBe(a.track.id)
    expect(songOfDay(el, DAY + 86_400_000, CITIES, TRACKS)!.atMs).toBeGreaterThan(a.atMs)
  })

  test("no songs, no pick", () => {
    expect(songOfDay(el, DAY, CITIES, [])).toBeNull()
  })
})

describe("smallCircle", () => {
  test("every point is the radius away from the middle, round the whole circle", () => {
    const ring = smallCircle(40, 170, 0.35, 36)
    expect(ring).toHaveLength(37)
    for (const p of ring) expect(greatCircleKm(40, 170, p.lat, p.lon)).toBeCloseTo(0.35 * EARTH_KM, 0)
    expect(ring[36].lat).toBeCloseTo(ring[0].lat)
  })
})

describe("whereBelow", () => {
  test("near a city of the globe's, where one is close", () => {
    const b = whereBelow(6.6, 3.4, CITIES, WORLD_LAND)
    expect(b).toMatchObject({ kind: "near", city: { id: "los" } })
  })

  test("over the open sea, named by its region", () => {
    expect(whereBelow(-5, -150, CITIES, WORLD_LAND)).toEqual({ kind: "sea", name: "the Pacific Ocean" })
    expect(whereBelow(-25, 75, CITIES, WORLD_LAND)).toEqual({ kind: "sea", name: "the Indian Ocean" })
    expect(whereBelow(28, -40, CITIES, WORLD_LAND)).toEqual({ kind: "sea", name: "the Atlantic Ocean" })
  })

  test("over land far from any city", () => {
    expect(whereBelow(23, 12, CITIES, WORLD_LAND)).toEqual({ kind: "land" })
  })

  test("seas by region", () => {
    expect(seaName(-60, 0)).toBe("the Southern Ocean")
    expect(seaName(35, 18)).toBe("the Mediterranean Sea")
    expect(seaName(12, -88)).toBe("the Pacific Ocean")
    expect(seaName(15, -80)).toBe("the Atlantic Ocean")
  })
})
