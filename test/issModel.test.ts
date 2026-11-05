import { describe, expect, test } from "vitest"
import { ISS_MATERIAL, VERTEX_FLOATS, issMesh } from "../src/globe/issModel"
import { issAt, issFrame, parseTle } from "../src/geo/orbit"

const L1 = "1 25544U 98067A   26308.88559265  .00005352  00000+0  10457-3 0  9991"
const L2 = "2 25544  51.6327 323.8448 0007212 348.6490  11.4335 15.49180468593565"
const T0 = 1793887876 * 1000

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: readonly number[]) => Math.sqrt(dot(a, a))

describe("issMesh", () => {
  const mesh = issMesh()
  const n = mesh.length / VERTEX_FLOATS
  const at = (k: number, f: number) => mesh[k * VERTEX_FLOATS + f]

  test("whole triangles, the station's real size: ~107 m along the truss, ~70 m across the arrays", () => {
    expect(n % 3).toBe(0)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, at(k, 0)); x1 = Math.max(x1, at(k, 0)); y0 = Math.min(y0, at(k, 1)); y1 = Math.max(y1, at(k, 1)) }
    expect(y1 - y0).toBeGreaterThan(100)
    expect(y1 - y0).toBeLessThan(115)
    expect(x1 - x0).toBeGreaterThan(65)
    expect(x1 - x0).toBeLessThan(80)
  })

  test("every normal is a unit vector", () => {
    for (let k = 0; k < n; k++) expect(len([at(k, 3), at(k, 4), at(k, 5)])).toBeCloseTo(1, 4)
  })

  test("the solar arrays are marked, so they can turn to the sun, and lie flat as made", () => {
    let arrays = 0
    for (let k = 0; k < n; k++) {
      if (at(k, 8) !== ISS_MATERIAL.array) continue
      arrays++
      expect(Math.abs(at(k, 5))).toBeCloseTo(1, 4)
    }
    expect(arrays).toBeGreaterThan(8 * 6)
  })
})

describe("issFrame", () => {
  const el = parseTle(L1, L2)!
  const f = issFrame(el, T0)

  test("three axes at right angles, each a unit vector", () => {
    for (const v of [f.forward, f.truss, f.nadir]) expect(len(v)).toBeCloseTo(1, 6)
    expect(dot(f.forward, f.truss)).toBeCloseTo(0, 6)
    expect(dot(f.forward, f.nadir)).toBeCloseTo(0, 6)
    expect(dot(f.truss, f.nadir)).toBeCloseTo(0, 6)
  })

  test("nadir points to the Earth's centre, and forward along the ground track", () => {
    expect(dot(f.nadir, f.position)).toBeCloseTo(-len(f.position), 6)
    const here = issAt(el, T0), later = issAt(el, T0 + 60_000)
    const w = (lat: number, lon: number) => {
      const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180
      return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]
    }
    const a = w(here.lat, here.lon), b = w(later.lat, later.lon), step = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    expect(dot(step, f.forward) / len(step)).toBeGreaterThan(0.99)
  })

  test("the truss lies across the orbit: right-handed with forward and nadir", () => {
    const [x, z] = [f.forward, f.nadir]
    const cross = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    expect(dot(cross, f.truss)).toBeCloseTo(1, 6)
  })
})
