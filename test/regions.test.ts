import { describe, expect, test } from "vitest"
import { clampLat, ZOOM_MAX, ZOOM_MIN } from "../src/globe/camera"
import { REGIONS } from "../src/globe/regions"

describe("the Regions menu", () => {
  test("flies to the seven continents", () => {
    expect(REGIONS.map(([name]) => name)).toEqual(["North America", "South America", "Europe", "Africa", "Asia", "Australia", "Antarctica"])
  })

  test("each view is one the camera can hold (its latitude within reach, its zoom in range)", () => {
    for (const [name, cam] of REGIONS) {
      expect(clampLat(cam.lat), name).toBe(cam.lat)
      expect(cam.lon, name).toBeGreaterThanOrEqual(-180)
      expect(cam.lon, name).toBeLessThan(180)
      expect(cam.zoom, name).toBeGreaterThanOrEqual(ZOOM_MIN)
      expect(cam.zoom, name).toBeLessThanOrEqual(ZOOM_MAX)
    }
  })
})
