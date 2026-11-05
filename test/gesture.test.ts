import { describe, expect, test } from "vitest"
import { ZOOM_MAX } from "../src/globe/camera"
import { MIN_SPREAD_PX, pinchFactor, pinched, spread } from "../src/globe/gesture"

describe("a pinch on the globe", () => {
  test("measures how far apart the two touches are", () => {
    expect(spread({ x: 10, y: 20 }, { x: 13, y: 24 })).toBe(5)
  })

  test("zooms by how much the touches have spread apart or closed in since it began", () => {
    expect(pinchFactor(100, 200)).toBe(2)
    expect(pinchFactor(200, 100)).toBe(0.5)
    expect(pinchFactor(150, 150)).toBe(1)
  })

  test("cannot zoom by leaps when the fingers land almost on each other", () => {
    expect(pinchFactor(2, 48)).toBe(48 / MIN_SPREAD_PX)
    expect(pinchFactor(120, 0)).toBe(MIN_SPREAD_PX / 120)
    expect(Number.isFinite(pinchFactor(0, 0))).toBe(true)
  })

  test("zooms from where it began, leaving the globe where it is now", () => {
    expect(pinched({ lon: 40, lat: -12, zoom: 5 }, 2, 1.5)).toEqual({ lon: 40, lat: -12, zoom: 3 })
    expect(pinched({ lon: 0, lat: 0, zoom: 1 }, 10, 4).zoom).toBe(ZOOM_MAX)
  })
})
