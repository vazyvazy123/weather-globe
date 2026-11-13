// The viewer's favourites: the cities they starred and the songs they hearted, kept in this browser alone (its
// localStorage; no cookie, nothing sent anywhere). A favourite city is always shown on the globe with a star, and listed
// first in the Regions menu; both are listed in the favourites' panel. Pure: reading a stored copy back takes only the
// ids the globe knows (its cities, or its songs), each once, at most a list's limit.

export const FAVORITES_KEY = "weather-globe:favorites:v1"
export const MAX_FAVORITES = 50
export const FAVORITE_SONGS_KEY = "weather-globe:favorite-songs:v1"
/** more songs than cities: a song is quicker to heart than a city to star, and the catalog has well over a hundred */
export const MAX_FAVORITE_SONGS = 100

/** The favourites in a stored copy (`raw`, as kept), of the ids `known`; none where it is no list. */
export function readFavorites(raw: string | null, known: ReadonlySet<string>, max = MAX_FAVORITES): string[] {
  let v: unknown
  try { v = raw == null ? null : JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const id of v) if (typeof id === "string" && known.has(id) && !out.includes(id)) out.push(id)
  return out.slice(0, max)
}

/** The list with `id` added at the end, or taken out where it is in it (a new list; none added past `max`). */
export function toggleFavorite(list: readonly string[], id: string, max = MAX_FAVORITES): string[] {
  if (list.includes(id)) return list.filter((k) => k !== id)
  return list.length >= max ? [...list] : [...list, id]
}
