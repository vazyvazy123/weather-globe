import { describe, expect, test } from "vitest"
import { WIND_GRID, type WindGrid } from "../src/data/wind"
import { sampleWind, windAt } from "../src/globe/windField"

const { rows: ROWS, cols: COLS } = WIND_GRID

/** a grid whose every hour, row and column is what `at` says */
function grid(hours: number, at: (h: number, i: number, j: number) => [number, number] | null, startS = 0): WindGrid {
  const u: Array<number | null> = [], v: Array<number | null> = []
  for (let h = 0; h < hours; h++) for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const w = at(h, i, j)
    u.push(w ? w[0] : null)
    v.push(w ? w[1] : null)
  }
  return { ...WIND_GRID, startS, hours, u, v, rowsIn: new Array(ROWS).fill(true) }
}
const latOf = (i: number) => WIND_GRID.lat0 + i * WIND_GRID.latStep
const lonOf = (j: number) => WIND_GRID.lon0 + j * WIND_GRID.lonStep

describe("windAt", () => {
  test("between two hours, the wind is between theirs", () => {
    const f = windAt(grid(2, (h) => [h === 0 ? 2 : 6, 0]), 1800)!
    expect(sampleWind(f, 0, 0)[0]).toBeCloseTo(4)
  })

  test("a row not read yet is filled from the rows either side", () => {
    const f = windAt(grid(1, (_, i) => (i === 5 ? null : [i, 0])), 0)!
    expect(sampleWind(f, lonOf(3), latOf(5))[0]).toBeCloseTo(5)
  })

  test("nothing known, or a read long past, is no wind", () => {
    expect(windAt(grid(1, () => null), 0)).toBeNull()
    expect(windAt(grid(2, () => [1, 1]), 3 * 3600)).toBeNull()
  })
})

describe("sampleWind", () => {
  const f = windAt(grid(1, (_, i, j) => [j, i]), 0)!

  test("at a grid point, the point's own wind", () => {
    const [u, v] = sampleWind(f, lonOf(7), latOf(4))
    expect(u).toBeCloseTo(7)
    expect(v).toBeCloseTo(4)
  })

  test("a steady wind is steady between the points", () => {
    const steady = windAt(grid(1, () => [3, -2]), 0)!
    const [u, v] = sampleWind(steady, 12.3, -41.7)
    expect(u).toBeCloseTo(3)
    expect(v).toBeCloseTo(-2)
  })

  test("the same wind either side of the date line", () => {
    const a = sampleWind(f, 179.5, 10), b = sampleWind(f, -180.5, 10)
    expect(a[0]).toBeCloseTo(b[0])
    expect(a[1]).toBeCloseTo(b[1])
  })

  test("it dies away toward the poles, past the grid's last rows", () => {
    const steady = windAt(grid(1, () => [10, 0]), 0)!
    expect(sampleWind(steady, 0, 75)[0]).toBeCloseTo(10)
    expect(Math.abs(sampleWind(steady, 0, 89.5)[0])).toBeLessThan(0.5)
    expect(Math.abs(sampleWind(steady, 0, -89.5)[0])).toBeLessThan(0.5)
  })
})
