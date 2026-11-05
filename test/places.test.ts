import { describe, expect, test } from "vitest"
import { CITIES } from "../src/data/cities"
import { completionOf, fold, mergeHits, searchLocal, type PlaceHit } from "../src/data/places"
import { geocodeUrl, parseGeocode } from "../src/data/geocode"

describe("fold", () => {
  test("ignores case and accents", () => {
    expect(fold("Bogotá")).toBe("bogota")
    expect(fold("SÃO Paulo")).toBe("sao paulo")
  })
})

describe("searchLocal", () => {
  test("a city whose name starts with what was typed comes first", () => {
    const hits = searchLocal("bag", CITIES)
    expect(hits[0]).toMatchObject({ kind: "city", id: "bgw", name: "Baghdad" })
  })

  test("accents need not be typed", () => {
    expect(searchLocal("bogota", CITIES)[0]).toMatchObject({ kind: "city", id: "bog" })
  })

  test("a country is found by its name, ahead of cities matched as well", () => {
    expect(searchLocal("iraq", CITIES)[0]).toMatchObject({ kind: "country", code: "IQ", name: "Iraq" })
  })

  test("a later word of a name matches too", () => {
    expect(searchLocal("york", CITIES).map((h) => h.name)).toContain("New York")
  })

  test("nothing typed, nothing found; and never more than asked for", () => {
    expect(searchLocal("  ", CITIES)).toEqual([])
    expect(searchLocal("a", CITIES, 5).length).toBeLessThanOrEqual(5)
  })
})

describe("completionOf", () => {
  const bogota: PlaceHit = { kind: "city", id: "bog", name: "Bogotá", detail: "Colombia", lat: 4.71, lon: -74.07 }

  test("the rest of the name, in its own spelling, after what was typed", () => {
    expect(completionOf("bog", bogota)).toBe("otá")
    expect(completionOf("BOGO", bogota)).toBe("tá")
  })

  test("none where the name does not start with it, or is all typed", () => {
    expect(completionOf("ota", bogota)).toBe("")
    expect(completionOf("bogota", bogota)).toBe("")
    expect(completionOf("bog", undefined)).toBe("")
  })
})

describe("geocoding", () => {
  test("the request asks for a few places by name, in English", () => {
    const url = new URL(geocodeUrl("Bagh"))
    expect(url.origin).toBe("https://geocoding-api.open-meteo.com")
    expect(url.searchParams.get("name")).toBe("Bagh")
    expect(url.searchParams.get("language")).toBe("en")
  })

  test("each answer becomes a place, its region and country beside it; malformed ones are left out", () => {
    const hits = parseGeocode({
      results: [
        { id: 1, name: "Bāgh", latitude: 33.98, longitude: 73.78, admin1: "Azad Kashmir", country: "Pakistan" },
        { id: 2, name: "Nowhere" },
        { id: 3, name: "Bagh", latitude: 29.9, longitude: 69.1, country: "Pakistan" },
      ],
    })
    expect(hits).toEqual([
      { kind: "place", key: "1", name: "Bāgh", detail: "Azad Kashmir, Pakistan", lat: 33.98, lon: 73.78 },
      { kind: "place", key: "3", name: "Bagh", detail: "Pakistan", lat: 29.9, lon: 69.1 },
    ])
    expect(parseGeocode({})).toEqual([])
  })

  test("keeps at most the six places asked for, each somewhere on the Earth", () => {
    const results = [
      { id: 0, name: "Off the map", latitude: 95, longitude: 10 },
      { id: 1, name: "Nor here", latitude: 10, longitude: 200 },
      ...Array.from({ length: 10 }, (_, k) => ({ id: k + 2, name: `Place ${k}`, latitude: k, longitude: k })),
    ]
    const hits = parseGeocode({ results })
    expect(hits.map((h) => h.name)).toEqual(["Place 0", "Place 1", "Place 2", "Place 3", "Place 4", "Place 5"])
  })

  test("countries are left out (the globe lists its own)", () => {
    expect(parseGeocode({ results: [{ id: 5, name: "France", latitude: 46, longitude: 2, feature_code: "PCLI", country: "France" }] })).toEqual([])
  })
})

describe("mergeHits and countries", () => {
  test("a place named as a listed country is that country, wherever its middle is said to be", () => {
    const local = searchLocal("france", CITIES)
    const remote: PlaceHit[] = [{ kind: "place", key: "5", name: "France", detail: "", lat: 46.0, lon: 2.0 }]
    expect(mergeHits(local, remote, 8).filter((h) => h.name === "France")).toHaveLength(1)
  })
})

describe("mergeHits", () => {
  test("a place that is a city already listed (its name, next to it) is left out; the others follow the listed ones", () => {
    const local = searchLocal("baghdad", CITIES)
    const remote: PlaceHit[] = [
      { kind: "place", key: "9", name: "Baghdad", detail: "Baghdad, Iraq", lat: 33.34, lon: 44.4 },
      { kind: "place", key: "8", name: "Baghdad", detail: "Tasmania, Australia", lat: -42.6, lon: 147.4 },
    ]
    const merged = mergeHits(local, remote, 8)
    expect(merged.filter((h) => h.name === "Baghdad")).toHaveLength(2)
    expect(merged[merged.length - 1]).toMatchObject({ key: "8" })
  })

  test("a listed name matched only inside a word comes after the places found that start with it", () => {
    const local = searchLocal("bag", CITIES)
    const remote: PlaceHit[] = [{ kind: "place", key: "1", name: "Bago", detail: "Bago Region, Myanmar", lat: 17.3, lon: 96.5 }]
    const names = mergeHits(local, remote, 8).map((h) => h.name)
    expect(names[0]).toBe("Baghdad")
    expect(names.indexOf("Bago")).toBeLessThan(names.indexOf("Trinidad & Tobago"))
  })
})
