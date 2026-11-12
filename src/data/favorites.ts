// The viewer's favourite cities: kept in this browser alone (its localStorage; no cookie, nothing sent anywhere), always
// shown on the globe with a star, and listed first in the Regions menu. Pure: reading a stored copy back takes only the
// cities the globe knows, each once, at most MAX_FAVORITES.

export const FAVORITES_KEY = "weather-globe:favorites:v1"
export const MAX_FAVORITES = 50

/** The favourites in a stored copy (`raw`, as kept), of the cities `known`; none where it is no list. */
export function readFavorites(raw: string | null, known: ReadonlySet<string>): string[] {
  let v: unknown
  try { v = raw == null ? null : JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const id of v) if (typeof id === "string" && known.has(id) && !out.includes(id)) out.push(id)
  return out.slice(0, MAX_FAVORITES)
}

/** The list with `id` added at the end, or taken out where it is in it (a new list; none added past MAX_FAVORITES). */
export function toggleFavorite(list: readonly string[], id: string): string[] {
  if (list.includes(id)) return list.filter((k) => k !== id)
  return list.length >= MAX_FAVORITES ? [...list] : [...list, id]
}
