// Finding a place by name as it is typed. The globe's own cities and their countries are found at once, ranked by how
// well the name fits what was typed — the whole name, its start, the start of a later word, anywhere in it — then
// countries before cities and the more important cities first. The rest of the best name is offered as the typing's
// completion. Places beyond the list (Open-Meteo's geocoding, geocode.ts) follow the listed ones. Pure.
import { greatCircleKm } from "../geo/distance"
import type { City } from "./cities"
import { countryName, MUSIC_CITIES } from "./music"

interface Spot {
  readonly name: string
  readonly detail: string
  readonly lat: number
  readonly lon: number
  /** what was typed is only inside a word of the name: listed after the places found that start with it */
  readonly weak?: boolean
}
export type PlaceHit =
  | (Spot & { readonly kind: "city"; readonly id: string; readonly music?: boolean })
  | (Spot & { readonly kind: "country"; readonly code: string })
  | (Spot & { readonly kind: "place"; readonly key: string })

/** a geocoded place this close to a listed city of its name is that city */
const SAME_PLACE_KM = 50
export const LOCAL_LIMIT = 6
export const ALL_LIMIT = 8

/** lower case, without accents */
const plain = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
/** a name or a query as compared: lower case, without accents or the spaces round it */
export const fold = (s: string): string => plain(s).trim()

/** how well a name fits what was typed: 0 the whole name, 1 its start, 2 the start of a later word, 3 anywhere in it,
 *  -1 not at all */
function fit(name: string, q: string): number {
  const n = fold(name)
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(/[\s\-'’.,()/]+/).some((w, k) => k > 0 && w.startsWith(q))) return 2
  return n.includes(q) ? 3 : -1
}

/** each country of the cities given, in the middle of its cities */
const countryCache = new WeakMap<readonly City[], Array<{ code: string; name: string; lat: number; lon: number }>>()
function countriesOf(cities: readonly City[]) {
  const held = countryCache.get(cities)
  if (held) return held
  const by = new Map<string, City[]>()
  for (const c of cities) by.set(c.country, [...(by.get(c.country) ?? []), c])
  const out = [...by].map(([code, cs]) => {
    // the mean of directions, so a country across the date line is not put on the far side of the world
    const s = cs.reduce((a, c) => a + Math.sin(c.lon * (Math.PI / 180)), 0), k = cs.reduce((a, c) => a + Math.cos(c.lon * (Math.PI / 180)), 0)
    return { code, name: countryName(code), lat: cs.reduce((a, c) => a + c.lat, 0) / cs.length, lon: Math.atan2(s, k) / (Math.PI / 180) }
  })
  countryCache.set(cities, out)
  return out
}

/** The globe's own places whose names fit what was typed, the best first. */
export function searchLocal(query: string, cities: readonly City[], limit = LOCAL_LIMIT): PlaceHit[] {
  const q = fold(query)
  if (!q) return []
  const scored: Array<{ hit: PlaceHit; fit: number; rank: number }> = []
  const weak = (f: number) => (f === 3 ? { weak: true } : {})
  for (const c of countriesOf(cities)) {
    const f = fit(c.name, q)
    if (f >= 0) scored.push({ hit: { kind: "country", code: c.code, name: c.name, detail: "Country", lat: c.lat, lon: c.lon, ...weak(f) }, fit: f, rank: 0 })
  }
  for (const c of cities) {
    const f = fit(c.name, q)
    if (f >= 0) scored.push({ hit: { kind: "city", id: c.id, name: c.name, detail: countryName(c.country), lat: c.lat, lon: c.lon, music: MUSIC_CITIES.has(c.id), ...weak(f) }, fit: f, rank: c.tier })
  }
  scored.sort((a, b) => a.fit - b.fit || a.rank - b.rank || a.hit.name.length - b.hit.name.length || a.hit.name.localeCompare(b.hit.name))
  return scored.slice(0, limit).map((s) => s.hit)
}

/** The rest of a place's name after what was typed (in the name's own spelling), to offer as the typing's completion;
 *  "" where the name does not start with it or is all typed. */
export function completionOf(query: string, hit: PlaceHit | undefined): string {
  const q = plain(query)
  if (!hit || !q.trim()) return ""
  for (let i = 1; i <= hit.name.length; i++) {
    const typed = plain(hit.name.slice(0, i))
    if (typed === q) return hit.name.slice(i)
    if (!q.startsWith(typed)) return ""
  }
  return ""
}

/** The listed places, then the geocoded ones that are not one of them, then the listed ones matched only inside a word;
 *  `limit` at most. */
export function mergeHits(local: readonly PlaceHit[], remote: readonly PlaceHit[], limit = ALL_LIMIT): PlaceHit[] {
  // a geocoded place is a listed one of its name nearby — or a listed country of its name, wherever (a country's middle
  // here is its cities')
  const listed = (r: PlaceHit) => local.some((l) => fold(l.name) === fold(r.name) && (l.kind === "country" || greatCircleKm(l.lat, l.lon, r.lat, r.lon) < SAME_PLACE_KM))
  return [...local.filter((h) => !h.weak), ...remote.filter((r) => !listed(r)), ...local.filter((h) => h.weak)].slice(0, limit)
}
