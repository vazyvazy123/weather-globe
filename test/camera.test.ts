import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { GlobeCameraController, ZOOM_MAX, ZOOM_MIN, cameraBetween, clampLat, wrapLon, zoomed } from "../src/globe/camera"
import { pinched } from "../src/globe/gesture"

describe("camera math", () => {
  test("wrapLon keeps longitudes in [-180, 180)", () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(180)).toBe(-180)
    expect(wrapLon(45)).toBe(45)
  })

  test("clampLat stops short of the poles", () => {
    expect(clampLat(89)).toBe(70)
    expect(clampLat(-89)).toBe(-70)
    expect(clampLat(12)).toBe(12)
  })

  test("zoom is clamped to its range", () => {
    expect(zoomed({ lon: 0, lat: 0, zoom: 1 }, 0.1).zoom).toBe(ZOOM_MIN)
    expect(zoomed({ lon: 0, lat: 0, zoom: 10 }, 10).zoom).toBe(ZOOM_MAX)
  })

  test("cameraBetween turns the short way across the date line", () => {
    const mid = cameraBetween({ lon: 170, lat: 0, zoom: 1 }, { lon: -170, lat: 10, zoom: 4 }, 0.5)
    expect(Math.abs(mid.lon)).toBeCloseTo(180)
    expect(mid.lat).toBeCloseTo(5)
    expect(mid.zoom).toBeCloseTo(2) // geometric
  })

  test("cameraBetween hits both ends", () => {
    const a = { lon: 10, lat: 20, zoom: 1 }, b = { lon: 40, lat: -5, zoom: 3 }
    expect(cameraBetween(a, b, 0)).toEqual(a)
    const end = cameraBetween(a, b, 1)
    expect(end.lon).toBeCloseTo(40)
    expect(end.zoom).toBeCloseTo(3)
  })
})

describe("GlobeCameraController", () => {
  test("set notifies subscribers and stops the tour", () => {
    const onTour = vi.fn()
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 }, onTour)
    const seen: number[] = []
    const off = c.subscribe((cam) => seen.push(cam.lon))
    c.set({ lon: 30, lat: 0, zoom: 1 })
    expect(seen).toEqual([30])
    expect(c.camera.lon).toBe(30)
    off()
    c.set({ lon: 40, lat: 0, zoom: 1 })
    expect(seen).toEqual([30])
    expect(onTour).not.toHaveBeenCalled()
  })

  test("without animation frames a fly-to jumps straight to its target", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 })
    const done = vi.fn()
    c.flyTo({ lon: 100, lat: 10, zoom: 2 }, done)
    expect(c.camera).toEqual({ lon: 100, lat: 10, zoom: 2 })
    expect(done).toHaveBeenCalledOnce()
  })

  test("the tour reports itself on and off", () => {
    const states: boolean[] = []
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 3 }, (on) => states.push(on))
    c.setTouring(true)
    expect(c.touring).toBe(true)
    expect(c.camera.zoom).toBe(1)
    c.set({ lon: 5, lat: 0, zoom: 1 })
    expect(c.touring).toBe(false)
    expect(states).toEqual([true, false])
    c.dispose()
  })
})

describe("following a moving target, and the tour's pace", () => {
  // animation frames run by hand: run(t) calls the frames asked for, at time t
  let frames = new Map<number, (t: number) => void>(), next = 1
  const run = (t: number) => { const due = [...frames.values()]; frames = new Map(); for (const cb of due) cb(t) }
  beforeEach(() => {
    frames = new Map()
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.set(next, cb); return next++ })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id) })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test("the camera eases onto the target, then keeps over it; its zoom stays the user's", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 })
    let lon = 50
    c.follow(() => ({ lon, lat: 10 }), 2)
    expect(c.following).toBe(true)
    run(0); run(400); run(1000)
    expect(c.camera.lon).toBeCloseTo(50)
    expect(c.camera.zoom).toBeCloseTo(2)
    lon = 60
    run(1040)
    expect(c.camera.lon).toBeCloseTo(60)
    // a zoom (the wheel, the buttons) keeps the follow going
    c.set(zoomed(c.camera, 2))
    lon = 61
    run(1080)
    expect(c.following).toBe(true)
    expect(c.camera).toEqual({ lon: 61, lat: 10, zoom: 4 })
  })

  test("a pinch keeps the follow going too, the target moving on under the fingers", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 })
    let lon = 50
    c.follow(() => ({ lon, lat: 10 }), 2)
    run(0); run(400); run(1000)
    const start = c.camera.zoom
    // the station moves on between the fingers touching and their moving apart
    lon = 55
    run(1040)
    c.set(pinched(c.camera, start, 1.5))
    lon = 58
    run(1080)
    expect(c.following).toBe(true)
    expect(c.camera).toEqual({ lon: 58, lat: 10, zoom: start * 1.5 })
  })

  test("a zoom of the user's own while it eases on is kept", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 })
    c.follow(() => ({ lon: 50, lat: 10 }), 2)
    run(0); run(200)
    const mid = c.camera.zoom
    c.set(zoomed(c.camera, 3))
    run(400); run(1000)
    expect(c.following).toBe(true)
    expect(c.camera.lon).toBeCloseTo(50)
    expect(c.camera.zoom).toBeCloseTo(mid * 3)
  })

  test("under reduced motion a follow only goes there: nothing is followed", () => {
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("reduce") }) })
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 }), ended = vi.fn()
    c.follow(() => ({ lon: 50, lat: 10 }), 2, ended)
    expect(c.camera).toEqual({ lon: 50, lat: 10, zoom: 2 })
    expect(c.following).toBe(false)
    expect(frames.size).toBe(0)
  })

  test("a move of the user's own, a fly-to or the tour ends it, and says so", () => {
    const ends: Array<(c: GlobeCameraController) => void> = [
      (c) => c.set({ lon: 5, lat: 5, zoom: 1 }),
      (c) => c.flyTo({ lon: 9, lat: 0, zoom: 1 }),
      (c) => c.setTouring(true),
      (c) => c.stopFollowing(),
    ]
    for (const end of ends) {
      const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 }), ended = vi.fn()
      c.follow(() => ({ lon: 50, lat: 0 }), 1, ended)
      run(0)
      end(c)
      expect(ended).toHaveBeenCalledOnce()
      expect(c.following).toBe(false)
    }
  })

  test("a follow moves the camera at most ~30 times a second, however fast the frames come", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 0, zoom: 1 }), seen: number[] = []
    c.subscribe((cam) => seen.push(cam.lon))
    c.follow(() => ({ lon: 50, lat: 0 }), 1)
    for (let t = 0; t <= 1000; t += 1000 / 120) run(t)
    expect(seen.length).toBeGreaterThanOrEqual(25)
    expect(seen.length).toBeLessThanOrEqual(32)
  })

  test("the tour turns the globe at most ~30 times a second", () => {
    const c = new GlobeCameraController({ lon: 0, lat: 18, zoom: 1 }), seen: number[] = []
    c.setTouring(true)
    for (let t = 0; t <= 1000; t += 1000 / 120) run(t)
    c.subscribe((cam) => seen.push(cam.lon))
    for (let t = 1000; t <= 2000; t += 1000 / 120) run(t)
    expect(seen.length).toBeGreaterThanOrEqual(25)
    expect(seen.length).toBeLessThanOrEqual(32)
    c.dispose()
  })
})
