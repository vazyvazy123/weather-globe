import { describe, expect, test } from "vitest"
import { FAVORITE_SONGS_KEY, FAVORITES_KEY, MAX_FAVORITE_SONGS, MAX_FAVORITES, readFavorites, toggleFavorite } from "../src/data/favorites"
import { TRACKS } from "../src/data/music"

const KNOWN = new Set(["par", "lon", "tyo", "nyc"])
const ids = (n: number, prefix = "c"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe("readFavorites", () => {
  test("takes back the cities stored, in their order", () => {
    expect(readFavorites('["tyo","par"]', KNOWN)).toEqual(["tyo", "par"])
  })

  test("drops what is no city of the globe's, a city twice, and anything that is not a list", () => {
    expect(readFavorites('["par","atlantis",3,null,"par","lon"]', KNOWN)).toEqual(["par", "lon"])
    expect(readFavorites("not json", KNOWN)).toEqual([])
    expect(readFavorites('{"par":true}', KNOWN)).toEqual([])
    expect(readFavorites(null, KNOWN)).toEqual([])
  })

  test("keeps no more than MAX_FAVORITES", () => {
    const many = Array.from({ length: MAX_FAVORITES + 10 }, (_, i) => `c${i}`)
    expect(readFavorites(JSON.stringify(many), new Set(many))).toHaveLength(MAX_FAVORITES)
  })
})

describe("toggleFavorite", () => {
  test("adds a city at the end, or takes it out, leaving the list given as it was", () => {
    const list = ["par"] as const
    expect(toggleFavorite(list, "tyo")).toEqual(["par", "tyo"])
    expect(toggleFavorite(["par", "tyo"], "par")).toEqual(["tyo"])
    expect(list).toEqual(["par"])
  })

  test("adds none past MAX_FAVORITES", () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `c${i}`)
    expect(toggleFavorite(full, "one-more")).toEqual(full)
  })
})

describe("a list's own limit", () => {
  test("reading keeps no more than the limit given", () => {
    const many = ids(20)
    expect(readFavorites(JSON.stringify(many), new Set(many), 5)).toEqual(many.slice(0, 5))
  })

  test("adding stops at the limit given, and taking out still works there", () => {
    const five = ids(5)
    expect(toggleFavorite(ids(4), "c4", 5)).toEqual(five)
    expect(toggleFavorite(five, "one-more", 5)).toEqual(five)
    expect(toggleFavorite(five, "c2", 5)).toEqual(["c0", "c1", "c3", "c4"])
  })
})

describe("the favourite songs", () => {
  const SONGS = new Set(TRACKS.map((t) => t.id))
  const [a, b] = TRACKS

  test("are kept apart from the cities, under a key of their own (a new one would lose the songs kept)", () => {
    expect(FAVORITE_SONGS_KEY).toBe("weather-globe:favorite-songs:v1")
    expect(FAVORITE_SONGS_KEY).not.toBe(FAVORITES_KEY)
  })

  test("come back as the songs the catalog has, each once, in their order", () => {
    expect(readFavorites(JSON.stringify([b.id, "a-song-gone", a.id, b.id, 7, null]), SONGS, MAX_FAVORITE_SONGS)).toEqual([b.id, a.id])
    expect(readFavorites(JSON.stringify(["par", "lon"]), SONGS, MAX_FAVORITE_SONGS)).toEqual([])
  })

  test("may be about a hundred, more than the cities", () => {
    expect(MAX_FAVORITE_SONGS).toBeGreaterThanOrEqual(100)
    expect(MAX_FAVORITE_SONGS).toBeGreaterThan(MAX_FAVORITES)
    const many = ids(MAX_FAVORITE_SONGS + 10, "s")
    expect(readFavorites(JSON.stringify(many), new Set(many), MAX_FAVORITE_SONGS)).toHaveLength(MAX_FAVORITE_SONGS)
  })

  test("are added past the cities' limit, but none past their own", () => {
    const asMany = ids(MAX_FAVORITES, "s")
    expect(toggleFavorite(asMany, "one-more", MAX_FAVORITE_SONGS)).toEqual([...asMany, "one-more"])
    const full = ids(MAX_FAVORITE_SONGS, "s")
    expect(toggleFavorite(full, "one-more", MAX_FAVORITE_SONGS)).toEqual(full)
  })
})
