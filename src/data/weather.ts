// The weather now from Open-Meteo (free for non-commercial use, CC BY 4.0; it answers cross-origin requests):
//  - every city's current temperature, cloud cover and WMO weather code, in a few multi-location requests (CITY_BATCH
//    cities each, so no address grows too long) at most every CITY_EVERY_MS;
//  - the world's clouds now on a coarse grid (10° × 20°, 252 points) in one request at most every GRID_EVERY_MS, for the
//    globe's cloud layer where the satellite has no picture, and its low cloud.
// Open-Meteo counts each location as a call, so both answers are kept in localStorage: a reload within the interval asks
// for nothing. Parsing is pure; a malformed point stays null and never shifts the points after it.
import type { CloudGrid } from "../globe/cloudField"
import { skyFromWmo, type Sky } from "../geo/sky"
import type { City } from "./cities"

/** what a weather read needs of a city */
type CityPoint = Pick<City, "id" | "lat" | "lon">

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
/** Open-Meteo counts each city as a call: ~230 cities hourly plus the grid every 3 h is ~7,500 calls for a page left
 *  open all day, inside the free 10,000 a day; a first visit with nothing stored costs ~480 (the limit is 600 a minute) */
export const CITY_EVERY_MS = 60 * 60_000
export const CITY_BATCH = 100
export const GRID_EVERY_MS = 3 * 3600_000
/** a failed read waits this long before the next try */
export const RETRY_MS = 10 * 60_000
/** the cloud grid: rows of latitude from 60°S to 70°N, columns of longitude from 180°W */
export const CLOUD_GRID = { lat0: -60, latStep: 10, rows: 14, lon0: -180, lonStep: 20, cols: 18 } as const
const TIMEOUT_MS = 20_000

export interface CityWeather {
  id: string
  tempC: number | null
  sky: Sky | null
  /** the cloud cover (%) */
  cloudPct: number | null
  /** the city's offset from UTC (s), for its local time */
  utcOffsetS: number | null
  /** when the reading is valid */
  atMs: number | null
}

/** The grid's points, row-major from the south-west corner. */
export function cloudGridPoints(): Array<{ lat: number; lon: number }> {
  const out: Array<{ lat: number; lon: number }> = []
  for (let i = 0; i < CLOUD_GRID.rows; i++) for (let j = 0; j < CLOUD_GRID.cols; j++) out.push({ lat: CLOUD_GRID.lat0 + i * CLOUD_GRID.latStep, lon: CLOUD_GRID.lon0 + j * CLOUD_GRID.lonStep })
  return out
}

/** One multi-location request for the current values of `fields`. */
export function currentUrl(points: ReadonlyArray<{ lat: number; lon: number }>, fields: readonly string[], timezone = false): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(2)).join(","),
    longitude: points.map((p) => p.lon.toFixed(2)).join(","),
    current: fields.join(","),
  })
  if (timezone) q.set("timezone", "auto")
  return `${OPEN_METEO_URL}?${q.toString()}`
}

export const CITY_FIELDS = ["temperature_2m", "cloud_cover", "weather_code"] as const
export const GRID_FIELDS = ["cloud_cover", "cloud_cover_high", "precipitation", "weather_code"] as const

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const record = (v: unknown): Record<string, unknown> | null => (v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
/** One location answers with an object, several with a list. */
const answers = (body: unknown): unknown[] => (Array.isArray(body) ? body : body != null ? [body] : [])

/** A city answer's `current` block in the cities' order. */
export function parseCities(body: unknown, cities: readonly CityPoint[]): CityWeather[] {
  const list = answers(body)
  return cities.map((c, i) => {
    const a = record(list[i]), cur = record(a?.current)
    const t = typeof cur?.time === "string" ? cur.time : null
    const offset = num(a?.utc_offset_seconds)
    // times come in the location's own zone without an offset
    const atMs = t != null && offset != null ? Date.parse(`${t}:00Z`) - offset * 1000 : null
    const cloudPct = num(cur?.cloud_cover)
    return {
      id: c.id,
      tempC: num(cur?.temperature_2m),
      sky: skyFromWmo(num(cur?.weather_code), cloudPct),
      cloudPct,
      utcOffsetS: offset,
      atMs: atMs != null && Number.isFinite(atMs) ? atMs : null,
    }
  })
}

/** A grid answer as the cloud layer's grid. */
export function parseGrid(body: unknown, atMs: number): CloudGrid {
  const list = answers(body)
  const n = CLOUD_GRID.rows * CLOUD_GRID.cols
  const cover: Array<number | null> = [], high: Array<number | null> = [], precip: Array<number | null> = [], storm: Array<0 | 1> = []
  for (let k = 0; k < n; k++) {
    const cur = record(record(list[k])?.current)
    const c = num(cur?.cloud_cover), h = num(cur?.cloud_cover_high), p = num(cur?.precipitation)
    cover.push(c == null ? null : Math.round(c))
    high.push(h == null ? null : Math.round(h))
    precip.push(p == null ? null : Math.round(p * 10) / 10)
    storm.push(skyFromWmo(num(cur?.weather_code), c)?.kind === "storm" ? 1 : 0)
  }
  return { atMs, ...CLOUD_GRID, cover, high, precip, storm }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "omit" })
  if (res.status !== 200) throw new Error(`Open-Meteo answered HTTP ${res.status}`)
  return res.json() as Promise<unknown>
}

/** `list` cut into runs of at most `size`, in order. */
export function batches<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function fetchCities(cities: readonly CityPoint[]): Promise<CityWeather[]> {
  const parts = await Promise.all(batches(cities, CITY_BATCH).map(async (part) => parseCities(await getJson(currentUrl(part, CITY_FIELDS, true)), part)))
  return parts.flat()
}

export async function fetchGrid(nowMs: number): Promise<CloudGrid> {
  return parseGrid(await getJson(currentUrl(cloudGridPoints(), GRID_FIELDS)), nowMs)
}
