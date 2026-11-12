// Earthquakes from the USGS's real-time feed (its Earthquake Hazards Program: public domain, no key, open to cross-origin
// requests, refreshed every minute): those of magnitude 2.5 and more in the past week, some 300 to 600 in ~250 KB (far
// less gzipped), read when the stored ones are older than QUAKE_EVERY_MS. Parsing is pure: a feature that is no
// earthquake (a quarry blast, an explosion) or whose numbers are out of range is left out, never guessed at.

export const QUAKE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson"
export const QUAKE_EVERY_MS = 5 * 60_000
const QUAKE_PAGES = "https://earthquake.usgs.gov/"
const MAX_QUAKES = 2000
const PLACE_MAX = 120
const ID_MAX = 40
/** a quake timed this far past the page's clock is taken as the clock being slow, beyond it as an error */
const CLOCK_SLACK_MS = 60_000
const DEPTH_KM = [-10, 800] as const
const MAG = [-2, 10] as const
const TIMEOUT_MS = 15_000

export interface Quake {
  readonly id: string
  readonly lat: number
  readonly lon: number
  /** below the surface (km) */
  readonly depthKm: number
  readonly mag: number
  readonly timeMs: number
  /** the USGS's own words for where ("30 km WSW of Lata, Solomon Islands"); "" where it gives none */
  readonly place: string
  /** its page on the USGS site; "" where the feed gives none of the USGS's own */
  readonly url: string
  /** a large quake at sea, flagged by the USGS where a tsunami is possible (a flag, not a warning) */
  readonly tsunami: boolean
  /** people who reported feeling it ("Did You Feel It?"); null = none */
  readonly felt: number | null
}

export interface QuakeFeed {
  /** when the USGS made the feed (ms) */
  readonly atMs: number
  /** weakest first: the strongest are drawn over the rest */
  readonly quakes: readonly Quake[]
}

/** control and text-direction characters: a place's name could be made to read otherwise with them */
const HIDDEN_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const within = (v: unknown, [lo, hi]: readonly [number, number]): v is number => isNum(v) && v >= lo && v <= hi
const usgsUrl = (v: unknown): v is string => typeof v === "string" && v.startsWith(QUAKE_PAGES)

function readQuake(f: unknown, nowMs: number): Quake | null {
  if (f == null || typeof f !== "object") return null
  const { id, properties: p, geometry: g } = f as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }
  if (typeof id !== "string" || id === "" || id.length > ID_MAX || !p || p.type !== "earthquake") return null
  const c = g?.coordinates
  if (!Array.isArray(c)) return null
  const [lon, lat, depthKm] = c as unknown[]
  if (!within(lon, [-180, 180]) || !within(lat, [-90, 90]) || !within(depthKm, DEPTH_KM)) return null
  if (!within(p.mag, MAG) || !within(p.time, [0, nowMs + CLOCK_SLACK_MS])) return null
  return {
    id, lat, lon, depthKm, mag: p.mag, timeMs: p.time,
    place: typeof p.place === "string" ? p.place.replace(HIDDEN_CHARS, "").trim().slice(0, PLACE_MAX) : "",
    url: usgsUrl(p.url) ? p.url : "",
    tsunami: p.tsunami === 1,
    felt: isNum(p.felt) && p.felt >= 0 ? Math.round(p.felt) : null,
  }
}

/** The feed's earthquakes, as of `nowMs` (the page's clock); null where the answer is no feed of features. */
export function parseQuakes(body: unknown, nowMs: number): QuakeFeed | null {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return null
  const { features, metadata } = body as { features?: unknown; metadata?: { generated?: unknown } }
  if (!Array.isArray(features)) return null
  const byId = new Map<string, Quake>()
  for (const f of features) {
    const q = readQuake(f, nowMs)
    if (q) byId.set(q.id, q)
  }
  const quakes = [...byId.values()].sort((a, b) => a.mag - b.mag).slice(-MAX_QUAKES)
  const generated = metadata?.generated
  return { atMs: isNum(generated) && generated <= nowMs + CLOCK_SLACK_MS ? generated : nowMs, quakes }
}

/** a stored quake, held to what a fresh read lets through (a stored copy could have been changed in between) */
function storedQuake(q: unknown): boolean {
  const k = q as Partial<Record<keyof Quake, unknown>> | null
  return k != null && typeof k.id === "string" && k.id !== "" && k.id.length <= ID_MAX &&
    within(k.lat, [-90, 90]) && within(k.lon, [-180, 180]) && within(k.depthKm, DEPTH_KM) && within(k.mag, MAG) && isNum(k.timeMs) &&
    typeof k.place === "string" && k.place.length <= PLACE_MAX && (k.url === "" || usgsUrl(k.url)) &&
    typeof k.tsunami === "boolean" && (k.felt === null || (isNum(k.felt) && k.felt >= 0))
}

/** Whether a stored copy is a feed (an old or damaged one is read again). */
export function validFeed(v: unknown): v is QuakeFeed {
  if (v == null || typeof v !== "object") return false
  const { atMs, quakes } = v as { atMs?: unknown; quakes?: unknown }
  return isNum(atMs) && Array.isArray(quakes) && quakes.length <= MAX_QUAKES && quakes.every(storedQuake)
}

export async function fetchQuakes(): Promise<QuakeFeed> {
  const res = await fetch(QUAKE_URL, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "omit" })
  if (res.status !== 200) throw new Error(`the USGS answered HTTP ${res.status}`)
  const feed = parseQuakes(await res.json(), Date.now())
  if (!feed) throw new Error("the USGS sent no earthquakes")
  return feed
}

/** the usual words for a quake's strength, by the magnitude each starts at */
const CLASSES = [[8, "Great"], [7, "Major"], [6, "Strong"], [5, "Moderate"], [4, "Light"]] as const

export const quakeClass = (mag: number): string => CLASSES.find(([from]) => mag >= from)?.[1] ?? "Minor"

/** How long ago a quake was, in the unit that reads best ("12 min ago", "5 hours ago", "3 days ago"). */
export function quakeAgo(timeMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - timeMs) / 60_000))
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}
