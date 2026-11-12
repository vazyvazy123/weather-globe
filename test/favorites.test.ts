import { describe, expect, test } from "vitest"
import { MAX_FAVORITES, readFavorites, toggleFavorite } from "../src/data/favorites"

const KNOWN = new Set(["par", "lon", "tyo", "nyc"])

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
