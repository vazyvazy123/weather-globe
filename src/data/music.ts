// The songs the globe plays: for many of its cities, a song or two that people there know by heart. The list is picked by
// hand (scripts/music-picks.json) and resolved by scripts/resolve-music.mjs into musicCatalog.json: each song's
// 30-second preview and cover from Apple's iTunes catalogue, its singer's photo from Deezer. Every address is checked
// here before the page uses it — https on the expected hosts only — so a bad entry costs a song, never the page.
// Each song stands on one city (`city`), the country's voice in its own place; a city also offers the songs of the rest
// of its country. Pure, but for the catalog it reads.
import catalog from "./musicCatalog.json"
import { CITIES, type City } from "./cities"

export interface Track {
  id: string
  /** the city the song stands on */
  city: string
  artist: string
  title: string
  genre: string | null
  album: string | null
  year: number | null
  /** the 30-second preview (AAC) */
  preview: string
  cover: string | null
  /** the singer's photo */
  artistImage: string | null
  /** the song in Apple Music */
  appleUrl: string | null
}

type CityRef = Pick<City, "id" | "lon" | "country">

const PREVIEW_HOSTS = [/^audio-ssl\.itunes\.apple\.com$/]
const COVER_HOSTS = [/^is\d+-ssl\.mzstatic\.com$/]
const PHOTO_HOSTS = [/^(cdn-images|e-cdns-images)\.dzcdn\.net$/]
const LINK_HOSTS = [/^music\.apple\.com$/]
/** a song heard within this many tracks is not chosen again by shuffle while there is another choice */
export const SHUFFLE_MEMORY = 12

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)
/** an https address on one of `hosts`, else null */
function safeUrl(v: unknown, hosts: readonly RegExp[]): string | null {
  const s = str(v)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" && hosts.some((h) => h.test(u.hostname)) ? u.toString() : null
  } catch {
    return null
  }
}

/** The catalog's well-formed tracks on known cities, each id once. A bad picture or link is dropped; a bad preview drops
 *  the track. */
export function checkTracks(raw: unknown, cityIds: ReadonlySet<string>): Track[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Track[] = []
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue
    const r = v as Record<string, unknown>
    const id = str(r.id), city = str(r.city), artist = str(r.artist), title = str(r.title)
    const preview = safeUrl(r.preview, PREVIEW_HOSTS)
    if (!id || !city || !artist || !title || !preview || !cityIds.has(city) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id, city, artist, title, preview,
      genre: str(r.genre),
      album: str(r.album),
      year: typeof r.year === "number" && Number.isInteger(r.year) ? r.year : null,
      cover: safeUrl(r.cover, COVER_HOSTS),
      artistImage: safeUrl(r.artistImage, PHOTO_HOSTS),
      appleUrl: safeUrl(r.appleUrl, LINK_HOSTS),
    })
  }
  return out
}

/** The play order: city by city from west to east, each city's songs together, as the list gives them. */
export function worldOrder(tracks: readonly Track[], cities: readonly Pick<City, "id" | "lon">[]): Track[] {
  const lon = new Map(cities.map((c) => [c.id, c.lon]))
  return tracks.map((t, i) => ({ t, i })).sort((a, b) => (lon.get(a.t.city) ?? 0) - (lon.get(b.t.city) ?? 0) || a.i - b.i).map((x) => x.t)
}

/** The songs a city offers: its own first, then the others of its country. */
export function tracksForCity(cityId: string, tracks: readonly Track[], cities: readonly CityRef[]): Track[] {
  const country = new Map(cities.map((c) => [c.id, c.country]))
  const here = country.get(cityId)
  if (!here) return []
  return [...tracks.filter((t) => t.city === cityId), ...tracks.filter((t) => t.city !== cityId && country.get(t.city) === here)]
}

/** The next song in shuffle: from another city and not heard lately; failing that from another city; failing that any
 *  other song. `recent` holds indices into `order`. */
export function nextShuffle(order: readonly Track[], current: number, recent: readonly number[], rand: () => number): number {
  const city = order[current]?.city
  const pick = (ok: (i: number) => boolean): number | null => {
    const choices = order.map((_, i) => i).filter((i) => i !== current && ok(i))
    return choices.length ? choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))] : null
  }
  return pick((i) => order[i].city !== city && !recent.includes(i)) ?? pick((i) => order[i].city !== city) ?? pick(() => true) ?? current
}

export const youtubeSearchUrl = (t: Pick<Track, "artist" | "title">): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.artist} ${t.title}`)}`

let regionNames: Intl.DisplayNames | null | undefined
/** A country's English name from its ISO code (the code itself where the browser does not know it). */
export function countryName(code: string): string {
  try {
    if (regionNames === undefined) regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

export const TRACKS: readonly Track[] = checkTracks(catalog, new Set(CITIES.map((c) => c.id)))
/** every song, west to east */
export const WORLD_ORDER: readonly Track[] = worldOrder(TRACKS, CITIES)
/** the cities a song stands on */
export const MUSIC_CITIES: ReadonlySet<string> = new Set(TRACKS.map((t) => t.city))
