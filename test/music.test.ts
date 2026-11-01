import { describe, expect, test } from "vitest"
import { CITIES } from "../src/data/cities"
import { checkTracks, countryName, nextShuffle, TRACKS, tracksForCity, worldOrder, youtubeSearchUrl, type Track } from "../src/data/music"
import { DEFAULT_VOLUME, loudness, parseVolume } from "../src/ui/useMusic"

const cities = [
  { id: "w", lon: -100, country: "US" },
  { id: "m", lon: 10, country: "DE" },
  { id: "m2", lon: 13, country: "DE" },
  { id: "e", lon: 140, country: "JP" },
]
const raw = (id: string, city: string, extra: Record<string, unknown> = {}) => ({
  id, city, artist: `Artist ${id}`, title: `Song ${id}`, genre: "Pop", album: null, year: 2001,
  preview: `https://audio-ssl.itunes.apple.com/itunes-assets/${id}.m4a`, cover: `https://is1-ssl.mzstatic.com/image/${id}/600x600bb.jpg`,
  artistImage: null, appleUrl: `https://music.apple.com/us/album/x/1?i=${id}`, itunesId: 1, ...extra,
})
const known = new Set(cities.map((c) => c.id))

describe("the music catalog", () => {
  test("well-formed tracks are kept as they are", () => {
    const [t] = checkTracks([raw("a", "m")], known)
    expect(t).toMatchObject({ id: "a", city: "m", title: "Song a", year: 2001, artistImage: null })
  })

  test("a track for an unknown city, without a preview or with a broken field is left out", () => {
    const out = checkTracks([raw("a", "nowhere"), raw("b", "m", { preview: null }), raw("c", "m", { title: 7 }), null, "x", raw("d", "m")], known)
    expect(out.map((t) => t.id)).toEqual(["d"])
  })

  test("only https addresses on the expected hosts are trusted; an untrusted picture is dropped, an untrusted preview drops the track", () => {
    const out = checkTracks([
      raw("a", "m", { preview: "http://audio-ssl.itunes.apple.com/a.m4a" }),
      raw("b", "m", { preview: "https://evil.example/b.m4a" }),
      raw("c", "m", { cover: "javascript:alert(1)", artistImage: "https://evil.example/p.jpg", appleUrl: "https://evil.example/" }),
      raw("d", "m", { artistImage: "https://cdn-images.dzcdn.net/images/artist/x/500x500-000000-80-0-0.jpg" }),
    ], known)
    expect(out.map((t) => t.id)).toEqual(["c", "d"])
    expect(out[0]).toMatchObject({ cover: null, artistImage: null, appleUrl: null })
    expect(out[1].artistImage).toContain("dzcdn.net")
  })

  test("a repeated id is kept once", () => {
    expect(checkTracks([raw("a", "m"), raw("a", "e")], known)).toHaveLength(1)
  })

  test("the world order runs west to east, a city's songs together", () => {
    const tracks = checkTracks([raw("e1", "e"), raw("m1", "m"), raw("w1", "w"), raw("m2", "m"), raw("x", "m2")], known)
    expect(worldOrder(tracks, cities).map((t) => t.id)).toEqual(["w1", "m1", "m2", "x", "e1"])
  })

  test("a city's music: its own songs first, then the rest of its country", () => {
    const tracks = checkTracks([raw("m1", "m"), raw("x", "m2"), raw("e1", "e")], known)
    expect(tracksForCity("m2", tracks, cities).map((t) => t.id)).toEqual(["x", "m1"])
    expect(tracksForCity("w", tracks, cities)).toEqual([])
  })

  test("shuffle never repeats the city playing or a song played lately", () => {
    const order = checkTracks([raw("a", "w"), raw("b", "w"), raw("c", "m"), raw("d", "e")], known)
    for (let k = 0; k < 50; k++) {
      const next = nextShuffle(order, 0, [3], Math.random)
      expect(order[next].id).toBe("c") // not w (playing), not d (lately)
    }
  })

  test("shuffle falls back gracefully when every other choice was heard lately", () => {
    const order = checkTracks([raw("a", "w"), raw("b", "m")], known)
    expect(nextShuffle(order, 0, [1], () => 0)).toBe(1)
    expect(nextShuffle(order.slice(0, 1), 0, [], () => 0)).toBe(0)
  })

  test("links and names for the player", () => {
    const t = checkTracks([raw("a", "m")], known)[0] as Track
    expect(youtubeSearchUrl(t)).toBe("https://www.youtube.com/results?search_query=Artist%20a%20Song%20a")
    expect(countryName("IQ")).toBe("Iraq")
    expect(countryName("??")).toBe("??")
  })

  test("the shipped catalog is all valid and anchored on known cities", () => {
    const ids = new Set(CITIES.map((c) => c.id))
    for (const t of TRACKS) expect(ids.has(t.city)).toBe(true)
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length)
  })
})

describe("the volume", () => {
  test("a stored level is read back; nothing stored, or anything odd, gives the usual level", () => {
    expect(parseVolume("0.35")).toBe(0.35)
    expect(parseVolume("0")).toBe(0)
    expect(parseVolume("1")).toBe(1)
    for (const bad of [null, "", "  ", "loud", "NaN", "-0.2", "1.5", "Infinity"]) expect(parseVolume(bad)).toBe(DEFAULT_VOLUME)
    expect(parseVolume(null, 0.5)).toBe(0.5)
  })

  test("the slider is squared into loudness: silent and full at its ends, room at the quiet end", () => {
    expect(loudness(0)).toBe(0)
    expect(loudness(1)).toBe(1)
    expect(loudness(0.5)).toBeCloseTo(0.25)
    expect(loudness(-1)).toBe(0)
    expect(loudness(2)).toBe(1)
    for (let p = 0.1; p <= 1; p += 0.1) expect(loudness(p)).toBeGreaterThan(loudness(p - 0.1))
  })
})
