import { describe, expect, test } from "vitest"
import { WIND_GRID, WIND_PARTS, mergeWind, parseWindPart, windComplete, windFrom, windPartPoints, windPartRows, windUrl } from "../src/data/wind"

const { rows: ROWS, cols: COLS } = WIND_GRID

/** an Open-Meteo answer for `n` points: each hour's speed and direction from the functions given */
function answer(n: number, times: number[], speed: (k: number, h: number) => number | null, dir: (k: number, h: number) => number | null) {
  return Array.from({ length: n }, (_, k) => ({
    hourly: { time: times, wind_speed_10m: times.map((_, h) => speed(k, h)), wind_direction_10m: times.map((_, h) => dir(k, h)) },
  }))
}

describe("the wind grid's parts", () => {
  test("every row is in exactly one part, and each part spans the world's latitudes", () => {
    const all = Array.from({ length: WIND_PARTS }, (_, k) => windPartRows(k))
    expect(all.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: ROWS }, (_, i) => i))
    for (const rows of all) {
      expect(rows[0]).toBeLessThan(WIND_PARTS)
      expect(rows[rows.length - 1]).toBeGreaterThanOrEqual(ROWS - WIND_PARTS)
    }
  })

  test("a part's points run row by row from the west", () => {
    const pts = windPartPoints([0, 4])
    expect(pts).toHaveLength(2 * COLS)
    expect(pts[0]).toEqual({ lat: WIND_GRID.lat0, lon: WIND_GRID.lon0 })
    expect(pts[1]).toEqual({ lat: WIND_GRID.lat0, lon: WIND_GRID.lon0 + WIND_GRID.lonStep })
    expect(pts[COLS]).toEqual({ lat: WIND_GRID.lat0 + 4 * WIND_GRID.latStep, lon: WIND_GRID.lon0 })
  })

  test("the request asks for the hourly 10 m wind in m/s, from the hour before", () => {
    const url = new URL(windUrl([{ lat: 10, lon: -20 }, { lat: 15, lon: 0 }]))
    expect(url.searchParams.get("latitude")).toBe("10.00,15.00")
    expect(url.searchParams.get("longitude")).toBe("-20.00,0.00")
    expect(url.searchParams.get("hourly")).toBe("wind_speed_10m,wind_direction_10m")
    expect(url.searchParams.get("wind_speed_unit")).toBe("ms")
    expect(url.searchParams.get("past_hours")).toBe("1")
    expect(url.searchParams.get("timeformat")).toBe("unixtime")
  })
})

describe("windFrom", () => {
  test("a wind from the north blows south; from the west, east", () => {
    const [u0, v0] = windFrom(10, 0)
    expect(u0).toBeCloseTo(0)
    expect(v0).toBeCloseTo(-10)
    const [u1, v1] = windFrom(10, 270)
    expect(u1).toBeCloseTo(10)
    expect(v1).toBeCloseTo(0)
  })
})

describe("parseWindPart", () => {
  const times = [3600, 7200, 10800]

  test("each point's hours become east and north winds, hour by hour", () => {
    const rows = [0, 4]
    const part = parseWindPart(answer(rows.length * COLS, times, (k, h) => k + h, () => 270), rows)
    expect(part).not.toBeNull()
    expect(part!.startS).toBe(3600)
    expect(part!.hours).toBe(3)
    // hour 1, the second row's third point: speed (COLS + 2) + 1, blowing east
    const at = (1 * rows.length + 1) * COLS + 2
    expect(part!.u[at]).toBeCloseTo(COLS + 3, 1)
    expect(part!.v[at]).toBeCloseTo(0, 1)
  })

  test("a malformed point stays unknown and never shifts the points after it", () => {
    const part = parseWindPart(answer(COLS, times, (k) => (k === 1 ? null : 5), () => 90), [0])!
    expect(part.u[1]).toBeNull()
    expect(part.u[2]).toBeCloseTo(-5)
  })

  test("an answer without times is no part", () => {
    expect(parseWindPart({ error: true, reason: "x" }, [0])).toBeNull()
  })
})

describe("mergeWind", () => {
  const rowsA = windPartRows(0), rowsB = windPartRows(1)
  const partOf = (rows: number[], times: number[], speed: number) => parseWindPart(answer(rows.length * COLS, times, () => speed, () => 270), rows)!

  test("parts fill their own rows; the grid is whole once every part is in", () => {
    let grid = mergeWind(null, partOf(rowsA, [0, 3600], 4))
    expect(windComplete(grid)).toBe(false)
    expect(grid.u[rowsA[1] * COLS]).toBeCloseTo(4)
    expect(grid.u[rowsB[0] * COLS]).toBeNull()
    for (let k = 1; k < WIND_PARTS; k++) grid = mergeWind(grid, partOf(windPartRows(k), [0, 3600], 4))
    expect(windComplete(grid)).toBe(true)
  })

  test("a part read an hour later lines up with the grid's hours", () => {
    const first = mergeWind(null, partOf(rowsA, [0, 3600, 7200], 4))
    const later = mergeWind(first, partOf(rowsB, [3600, 7200, 10800], 6))
    const cell = (h: number) => later.u[(h * ROWS + rowsB[0]) * COLS]
    expect(later.startS).toBe(0)
    expect(cell(0)).toBeNull()
    expect(cell(1)).toBeCloseTo(6)
    expect(cell(2)).toBeCloseTo(6)
  })

  test("the grid given is left as it was", () => {
    const first = mergeWind(null, partOf(rowsA, [0], 4))
    const before = first.u.slice()
    mergeWind(first, partOf(rowsB, [0], 6))
    expect(first.u).toEqual(before)
  })
})
