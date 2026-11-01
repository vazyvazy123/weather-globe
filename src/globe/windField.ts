// The wind at a moment, anywhere on the globe: a read's hours (wind.ts) blended to the moment asked, the rows not read
// yet filled from the rows either side, and read between the grid's points along a cubic (Catmull-Rom) curve each way —
// smooth enough for the wind's particles to follow without bending at the grid's lines. Past the grid's last rows (75°)
// the wind dies away toward the poles. Pure.
import type { WindGrid } from "../data/wind"

/** The wind at one moment: east (u) and north (v) parts in m/s, row-major from the south-west, every point filled. */
export interface WindFrame {
  readonly lat0: number
  readonly latStep: number
  readonly rows: number
  readonly lon0: number
  readonly lonStep: number
  readonly cols: number
  readonly u: Float32Array
  readonly v: Float32Array
}

/** a read this long past its last hour is no wind (s) */
const STALE_S = 3600
/** the wind dies away from the grid's last rows to here (°) */
const POLE_LAT = 89

/** The wind at `tS` (unix seconds); null with nothing known, or the read long past. */
export function windAt(grid: WindGrid, tS: number): WindFrame | null {
  const fh = (tS - grid.startS) / 3600
  if (fh > grid.hours - 1 + STALE_S / 3600) return null
  const at = Math.min(Math.max(fh, 0), grid.hours - 1)
  const h0 = Math.floor(at), h1 = Math.min(h0 + 1, grid.hours - 1), f = at - h0
  const { rows, cols } = grid, n = rows * cols
  const blend = (a: ReadonlyArray<number | null>, k: number): number | null => {
    const x = a[h0 * n + k], y = a[h1 * n + k]
    return x != null && y != null ? x + (y - x) * f : x ?? y ?? null
  }
  const u = new Float32Array(n), v = new Float32Array(n)
  let any = false
  for (let j = 0; j < cols; j++) {
    const ku: Array<number | null> = [], kv: Array<number | null> = []
    for (let i = 0; i < rows; i++) {
      const a = blend(grid.u, i * cols + j), b = blend(grid.v, i * cols + j)
      const known = a != null && b != null
      ku.push(known ? a : null)
      kv.push(known ? b : null)
      any ||= known
    }
    for (let i = 0; i < rows; i++) {
      u[i * cols + j] = filled(ku, i)
      v[i * cols + j] = filled(kv, i)
    }
  }
  return any ? { lat0: grid.lat0, latStep: grid.latStep, rows, lon0: grid.lon0, lonStep: grid.lonStep, cols, u, v } : null
}

/** a column's value at row `i`: its own, else a straight line between the nearest known rows either side (the nearest
 *  one past the ends), else none */
function filled(col: ReadonlyArray<number | null>, i: number): number {
  const own = col[i]
  if (own != null) return own
  let p = i - 1, q = i + 1
  while (p >= 0 && col[p] == null) p--
  while (q < col.length && col[q] == null) q++
  const a = p >= 0 ? col[p] : null, b = q < col.length ? col[q] : null
  if (a != null && b != null) return a + ((b - a) * (i - p)) / (q - p)
  return a ?? b ?? 0
}

/** the Catmull-Rom weights of the four points around a place `t` (0..1) of the way from the second to the third */
function weights(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t
  return [0.5 * (-t3 + 2 * t2 - t), 0.5 * (3 * t3 - 5 * t2 + 2), 0.5 * (-3 * t3 + 4 * t2 + t), 0.5 * (t3 - t2)]
}

/** The wind (east, north; m/s) at a place (degrees). */
export function sampleWind(f: WindFrame, lon: number, lat: number): [number, number] {
  const top = f.lat0 + (f.rows - 1) * f.latStep
  const past = lat > top ? (lat - top) / (POLE_LAT - top) : lat < f.lat0 ? (f.lat0 - lat) / (POLE_LAT + f.lat0) : 0
  if (past >= 1) return [0, 0]
  const fade = 1 - past * past * (3 - 2 * past)
  const x = (lon - f.lon0) / f.lonStep, y = Math.min(Math.max((lat - f.lat0) / f.latStep, 0), f.rows - 1)
  const j = Math.floor(x), i = Math.min(Math.floor(y), f.rows - 2)
  const wx = weights(x - j), wy = weights(y - i)
  let u = 0, v = 0
  for (let a = 0; a < 4; a++) {
    const row = Math.min(Math.max(i - 1 + a, 0), f.rows - 1) * f.cols
    for (let b = 0; b < 4; b++) {
      const col = (((j - 1 + b) % f.cols) + f.cols) % f.cols, w = wy[a] * wx[b]
      u += w * f.u[row + col]
      v += w * f.v[row + col]
    }
  }
  return [u * fade, v * fade]
}
