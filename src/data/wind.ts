// The wind near the ground from Open-Meteo, on a grid of its own (7.5° of latitude × 10° of longitude: 756 points from
// 75°S to 75°N): each point's 10 m wind, hour by hour from the hour before the read to WIND_HOURS after it — so one read
// lasts half a day, the globe stepping through the hours itself. Open-Meteo counts each point as a call, so a read
// (756 calls) is made only while the wind is shown, at most every WIND_EVERY_MS (~1,500 calls a day beside the ~7,500 of
// the cities and the clouds, inside the free 10,000). Its limit being 600 calls a minute, a read is WIND_PARTS requests,
// each made when the minute's calls leave it room (meteoBudget.ts) and each a spread of rows across the world, so the
// wind shows from the first. Parsing is pure; a malformed point stays unknown and never shifts the points after it.
import { OPEN_METEO_URL } from "./weather"

/** the grid: rows of latitude from 75°S, columns of longitude from 180°W */
export const WIND_GRID = { lat0: -75, latStep: 7.5, rows: 21, lon0: -180, lonStep: 10, cols: 36 } as const
/** the hours a read covers after the present one */
export const WIND_HOURS = 24
export const WIND_EVERY_MS = 12 * 3600_000
export const WIND_PARTS = 4
const TIMEOUT_MS = 20_000

/** The wind for the hours read: east (u) and north (v) components in m/s, hour-major, then row-major from the
 *  south-west corner; null where unknown. */
export interface WindGrid {
  readonly lat0: number
  readonly latStep: number
  readonly rows: number
  readonly lon0: number
  readonly lonStep: number
  readonly cols: number
  /** the first hour (unix seconds), and how many hours follow it an hour apart */
  readonly startS: number
  readonly hours: number
  readonly u: ReadonlyArray<number | null>
  readonly v: ReadonlyArray<number | null>
  /** the rows read so far */
  readonly rowsIn: ReadonlyArray<boolean>
}

/** A part's answer: like the grid, for its own rows only. */
export interface WindPart {
  readonly rows: readonly number[]
  readonly startS: number
  readonly hours: number
  readonly u: ReadonlyArray<number | null>
  readonly v: ReadonlyArray<number | null>
}

/** Part `k`'s rows: every WIND_PARTS-th row from row k, so each part spans the world's latitudes. */
export function windPartRows(k: number): number[] {
  const out: number[] = []
  for (let i = k; i < WIND_GRID.rows; i += WIND_PARTS) out.push(i)
  return out
}

/** The points of the rows given, row by row from the west. */
export function windPartPoints(rows: readonly number[]): Array<{ lat: number; lon: number }> {
  return rows.flatMap((i) => Array.from({ length: WIND_GRID.cols }, (_, j) => ({ lat: WIND_GRID.lat0 + i * WIND_GRID.latStep, lon: WIND_GRID.lon0 + j * WIND_GRID.lonStep })))
}

/** One multi-location request for the hourly 10 m wind, from the hour before to WIND_HOURS ahead. */
export function windUrl(points: ReadonlyArray<{ lat: number; lon: number }>): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(2)).join(","),
    longitude: points.map((p) => p.lon.toFixed(2)).join(","),
    hourly: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "ms",
    past_hours: "1",
    forecast_hours: String(WIND_HOURS),
    timeformat: "unixtime",
  })
  return `${OPEN_METEO_URL}?${q.toString()}`
}

/** A wind of `speed` m/s from `fromDeg` (clockwise from north, where it blows from) as its east and north parts. */
export function windFrom(speed: number, fromDeg: number): [number, number] {
  const a = fromDeg * (Math.PI / 180)
  return [-speed * Math.sin(a), -speed * Math.cos(a)]
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const record = (v: unknown): Record<string, unknown> | null => (v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const tenth = (x: number): number => Math.round(x * 10) / 10

/** A part's answer (one location answers with an object, several with a list); null without its hours. */
export function parseWindPart(body: unknown, rows: readonly number[]): WindPart | null {
  const answers = Array.isArray(body) ? body : body != null ? [body] : []
  const times = list(record(record(answers[0])?.hourly)?.time).map(num)
  const startS = times[0]
  if (startS == null) return null
  const hours = times.length, n = rows.length * WIND_GRID.cols
  const u: Array<number | null> = new Array(hours * n).fill(null), v: Array<number | null> = new Array(hours * n).fill(null)
  for (let k = 0; k < n; k++) {
    const hourly = record(record(answers[k])?.hourly)
    const sp = list(hourly?.wind_speed_10m), dir = list(hourly?.wind_direction_10m)
    for (let h = 0; h < hours; h++) {
      const s = num(sp[h]), d = num(dir[h])
      if (s == null || d == null) continue
      const [we, sn] = windFrom(s, d)
      u[h * n + k] = tenth(we)
      v[h * n + k] = tenth(sn)
    }
  }
  return { rows, startS, hours, u, v }
}

/** The grid with a part's rows put in (a new grid; the one given is left as it was). The grid keeps its own hours; a
 *  part read across the turn of an hour lines up by its time. */
export function mergeWind(grid: WindGrid | null, part: WindPart): WindGrid {
  const { rows, cols } = WIND_GRID
  const base: WindGrid = grid ?? {
    ...WIND_GRID, startS: part.startS, hours: part.hours,
    u: new Array(part.hours * rows * cols).fill(null), v: new Array(part.hours * rows * cols).fill(null), rowsIn: new Array(rows).fill(false),
  }
  const u = base.u.slice(), v = base.v.slice(), rowsIn = base.rowsIn.slice()
  const shift = Math.round((part.startS - base.startS) / 3600), n = part.rows.length * cols
  part.rows.forEach((i, ri) => {
    rowsIn[i] = true
    for (let h = 0; h < part.hours; h++) {
      const gh = h + shift
      if (gh < 0 || gh >= base.hours) continue
      for (let j = 0; j < cols; j++) {
        u[(gh * rows + i) * cols + j] = part.u[h * n + ri * cols + j]
        v[(gh * rows + i) * cols + j] = part.v[h * n + ri * cols + j]
      }
    }
  })
  return { ...base, u, v, rowsIn }
}

/** Every row has been read. */
export const windComplete = (grid: WindGrid): boolean => grid.rowsIn.every(Boolean)

/** Part `k` of a read. */
export async function fetchWindPart(k: number): Promise<WindPart> {
  const rows = windPartRows(k)
  const res = await fetch(windUrl(windPartPoints(rows)), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "omit" })
  if (res.status !== 200) throw new Error(`Open-Meteo answered HTTP ${res.status}`)
  const part = parseWindPart(await res.json(), rows)
  if (!part) throw new Error("Open-Meteo sent no hours")
  return part
}
