import { describe, expect, test } from "vitest"
import { parseQuakes, quakeAgo, quakeClass, validFeed, type Quake } from "../src/data/quakes"

const NOW = Date.UTC(2026, 10, 12, 18, 0)
const HOUR = 3600_000

/** a feature as the USGS feed gives it (trimmed to the fields read, plus a few it carries and the page ignores) */
const feature = (over: { id?: string; props?: Record<string, unknown>; coords?: unknown } = {}) => ({
  type: "Feature",
  id: over.id ?? "us7000abcd",
  properties: {
    mag: 6.4, place: "30 km WSW of Lata, Solomon Islands", time: NOW - 3 * HOUR, updated: NOW - HOUR, tz: null,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd", felt: 12, tsunami: 1, sig: 630, type: "earthquake",
    title: "M 6.4 - 30 km WSW of Lata, Solomon Islands", ...over.props,
  },
  geometry: { type: "Point", coordinates: over.coords ?? [165.55, -10.81, 35.2] },
})
const collection = (features: unknown[], generated = NOW - 60_000) => ({ type: "FeatureCollection", metadata: { generated, count: features.length }, features })

describe("parseQuakes", () => {
  test("reads each earthquake: where, how deep, how strong, when, and its USGS page", () => {
    const feed = parseQuakes(collection([feature()]), NOW)
    expect(feed?.atMs).toBe(NOW - 60_000)
    expect(feed?.quakes).toEqual<Quake[]>([{
      id: "us7000abcd", lat: -10.81, lon: 165.55, depthKm: 35.2, mag: 6.4, timeMs: NOW - 3 * HOUR,
      place: "30 km WSW of Lata, Solomon Islands", url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd", tsunami: true, felt: 12,
    }])
  })

  test("orders them weakest first, so the strongest are drawn over the rest; each once", () => {
    const feed = parseQuakes(collection([
      feature({ id: "a", props: { mag: 5.1 } }), feature({ id: "b", props: { mag: 2.7 } }), feature({ id: "c", props: { mag: 7.0 } }), feature({ id: "b", props: { mag: 2.7 } }),
    ]), NOW)
    expect(feed?.quakes.map((q) => q.id)).toEqual(["b", "a", "c"])
  })

  test("leaves out what is no earthquake, and what is out of range, rather than guess", () => {
    const feed = parseQuakes(collection([
      feature({ id: "blast", props: { type: "quarry blast" } }),
      feature({ id: "nomag", props: { mag: null } }),
      feature({ id: "huge", props: { mag: 12 } }),
      feature({ id: "future", props: { time: NOW + 10 * 60_000 } }),
      feature({ id: "nolat", coords: [10, "x", 5] }),
      feature({ id: "offworld", coords: [10, 95, 5] }),
      feature({ id: "deep", coords: [10, 10, 2000] }),
      feature({ id: "", props: {} }),
      "nonsense",
      feature({ id: "kept" }),
    ]), NOW)
    expect(feed?.quakes.map((q) => q.id)).toEqual(["kept"])
  })

  test("keeps no control or text-direction characters in a place's name", () => {
    const q = parseQuakes(collection([feature({ props: { place: "10 km N of ‮anytown‬\u0007" } })]), NOW)?.quakes[0]
    expect(q?.place).toBe("10 km N of anytown")
  })

  test("links only to the USGS's own pages, and keeps a place's name short", () => {
    const q = parseQuakes(collection([feature({ props: { url: "https://example.com/phish", place: "x".repeat(400), felt: -3, tsunami: 0 } })]), NOW)?.quakes[0]
    expect(q?.url).toBe("")
    expect(q?.place.length).toBe(120)
    expect(q?.felt).toBeNull()
    expect(q?.tsunami).toBe(false)
  })

  test("is null for anything but a feed of features", () => {
    expect(parseQuakes(null, NOW)).toBeNull()
    expect(parseQuakes({ type: "FeatureCollection" }, NOW)).toBeNull()
    expect(parseQuakes([feature()], NOW)).toBeNull()
  })
})

describe("validFeed", () => {
  test("takes a stored feed back, and nothing else", () => {
    const feed = parseQuakes(collection([feature()]), NOW)
    expect(validFeed(JSON.parse(JSON.stringify(feed)))).toBe(true)
    expect(validFeed({ atMs: 1, quakes: [{ id: "a", lat: "north" }] })).toBe(false)
    expect(validFeed({ quakes: [] })).toBe(false)
    expect(validFeed("feed")).toBe(false)
  })

  test("holds a stored copy to what a fresh read would let through", () => {
    const q = parseQuakes(collection([feature()]), NOW)!.quakes[0]
    const tampered = (over: Partial<Record<keyof Quake, unknown>>) => validFeed({ atMs: NOW, quakes: [{ ...q, ...over }] })
    expect(tampered({})).toBe(true)
    expect(tampered({ url: "javascript:alert(1)" })).toBe(false)
    expect(tampered({ url: "https://example.com/x" })).toBe(false)
    expect(tampered({ url: "" })).toBe(true)
    expect(tampered({ lat: 900 })).toBe(false)
    expect(tampered({ mag: 40 })).toBe(false)
    expect(tampered({ place: "x".repeat(500) })).toBe(false)
    expect(tampered({ felt: -1 })).toBe(false)
    expect(validFeed({ atMs: NOW, quakes: Array.from({ length: 2001 }, (_, i) => ({ ...q, id: `q${i}` })) })).toBe(false)
  })
})

describe("quakeClass", () => {
  test("names a quake's strength in the usual words", () => {
    expect([2.5, 3.9, 4, 5.4, 6.4, 7.1, 8.2].map(quakeClass)).toEqual(["Minor", "Minor", "Light", "Moderate", "Strong", "Major", "Great"])
  })
})

describe("quakeAgo", () => {
  test("says how long ago, in the unit that reads best", () => {
    expect(quakeAgo(NOW - 20_000, NOW)).toBe("just now")
    expect(quakeAgo(NOW - 12 * 60_000, NOW)).toBe("12 min ago")
    expect(quakeAgo(NOW - 1 * HOUR, NOW)).toBe("1 hour ago")
    expect(quakeAgo(NOW - 5 * HOUR - 20 * 60_000, NOW)).toBe("5 hours ago")
    expect(quakeAgo(NOW - 30 * HOUR, NOW)).toBe("1 day ago")
    expect(quakeAgo(NOW - 3.2 * 24 * HOUR, NOW)).toBe("3 days ago")
  })
})
