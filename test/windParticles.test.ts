import { describe, expect, test } from "vitest"
import { WIND_GRID, type WindGrid } from "../src/data/wind"
import { windAt, type WindFrame } from "../src/globe/windField"
import { SEG_FLOATS, TRAIL, WindParticles, cameraMatrix, toCamera, unproject } from "../src/globe/windParticles"

const RAD = Math.PI / 180

/** the same numbers every run */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function steady(u: number, v: number): WindFrame {
  const n = WIND_GRID.rows * WIND_GRID.cols
  const g: WindGrid = { ...WIND_GRID, startS: 0, hours: 1, u: new Array(n).fill(u), v: new Array(n).fill(v), rowsIn: new Array(WIND_GRID.rows).fill(true) }
  return windAt(g, 0)!
}

const CAM = { lon: 20, lat: 10 }
const SCREEN = { w: 800, h: 600, cx: 400, cy: 300, r: 270 }
const world = (lon: number, lat: number): [number, number, number] =>
  [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]

describe("the camera's projection", () => {
  test("the point under the camera faces the viewer, at the disk's centre", () => {
    const [x, y, z] = toCamera(cameraMatrix(CAM), ...world(CAM.lon, CAM.lat))
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(1)
  })

  test("a point east of it is to the right; north of it, up", () => {
    const m = cameraMatrix(CAM)
    expect(toCamera(m, ...world(CAM.lon + 10, CAM.lat))[0]).toBeGreaterThan(0)
    expect(toCamera(m, ...world(CAM.lon, CAM.lat + 10))[1]).toBeGreaterThan(0)
  })

  test("unproject undoes the projection", () => {
    const [x, y] = toCamera(cameraMatrix(CAM), ...world(47, -12))
    const ll = unproject(CAM, x, y)!
    expect(ll[0]).toBeCloseTo(47)
    expect(ll[1]).toBeCloseTo(-12)
    expect(unproject(CAM, 0.9, 0.9)).toBeNull()
  })
})

describe("WindParticles", () => {
  test("the particles fill the globe in view: more as it fills more of the screen", () => {
    const far = new WindParticles(seeded(1)), near = new WindParticles(seeded(1))
    far.step(steady(5, 0), CAM, { ...SCREEN, r: 100 }, 1 / 30)
    near.step(steady(5, 0), CAM, { ...SCREEN, r: 900 }, 1 / 30)
    expect(far.count).toBeGreaterThan(30)
    expect(near.count).toBeGreaterThan(far.count * 3)
  })

  test("in a steady east wind, a particle drifts east along its latitude", () => {
    const p = new WindParticles(seeded(2)), f = steady(10, 0)
    p.step(f, CAM, SCREEN, 1 / 30)
    const [lon0, lat0] = p.at(0)
    p.step(f, CAM, SCREEN, 1 / 30)
    const [lon1, lat1] = p.at(0)
    expect(lon1).toBeGreaterThan(lon0)
    expect(lat1).toBeCloseTo(lat0, 5)
  })

  test("trails show from the second step, and stay inside the screen and on the near side", () => {
    const p = new WindParticles(seeded(3)), f = steady(-6, 8)
    const out = new Float32Array(p.capacity * (TRAIL - 1) * SEG_FLOATS)
    p.step(f, CAM, SCREEN, 1 / 30)
    expect(p.segments(CAM, SCREEN, 1, out)).toBe(0)
    for (let k = 0; k < 40; k++) p.step(f, CAM, SCREEN, 1 / 30)
    const n = p.segments(CAM, SCREEN, 2, out)
    expect(n).toBeGreaterThan(p.count)
    // each field's range over every segment: x, y (both ends), opacity, speed
    const range = (pick: (o: number) => number[]) => {
      const all = Array.from({ length: n }, (_, s) => pick(s * SEG_FLOATS)).flat()
      return [Math.min(...all), Math.max(...all)]
    }
    const [x0, x1] = range((o) => [out[o], out[o + 2]]), [y0, y1] = range((o) => [out[o + 1], out[o + 3]])
    expect(x0).toBeGreaterThanOrEqual(-40)
    expect(x1).toBeLessThanOrEqual(2 * SCREEN.w + 40)
    expect(y0).toBeGreaterThanOrEqual(-40)
    expect(y1).toBeLessThanOrEqual(2 * SCREEN.h + 40)
    const [a0, a1] = range((o) => [out[o + 4]]), [s0, s1] = range((o) => [out[o + 5]])
    expect(a0).toBeGreaterThan(0)
    expect(a1).toBeLessThanOrEqual(1)
    // 10 m/s, less only toward the pole (in view here), where the wind dies away
    expect(s0).toBeGreaterThan(0)
    expect(s1).toBeLessThanOrEqual(10.01)
  })

  test("a particle that drifts off the globe's near side is born again inside the view", () => {
    const p = new WindParticles(seeded(4)), f = steady(30, 0)
    for (let k = 0; k < 400; k++) p.step(f, CAM, SCREEN, 1 / 10)
    const m = cameraMatrix(CAM)
    for (let i = 0; i < p.count; i++) {
      const [lon, lat] = p.at(i)
      expect(toCamera(m, ...world(lon, lat))[2]).toBeGreaterThan(0)
    }
  })

  test("settle draws whole trails at once (reduced motion: no frames follow)", () => {
    const p = new WindParticles(seeded(5)), f = steady(8, 0)
    const out = new Float32Array(p.capacity * (TRAIL - 1) * SEG_FLOATS)
    p.settle(f, CAM, SCREEN)
    expect(p.segments(CAM, SCREEN, 1, out)).toBeGreaterThan(p.count * (TRAIL - 3))
  })
})
