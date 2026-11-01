import { describe, expect, test } from "vitest"
import { satCloudField } from "../src/globe/satClouds"

/** a grey image of the world with a bright (cold) block in the middle */
function image(w: number, h: number, ground: number, block: number) {
  const gray = new Uint8Array(w * h).fill(ground)
  for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y++) for (let x = Math.floor(w * 0.4); x < Math.floor(w * 0.6); x++) gray[y * w + x] = block
  return { w, h, gray, alpha: null, latTop: 72, latBottom: -72 }
}

describe("satCloudField", () => {
  const w = 360, h = 144
  const field = satCloudField(image(w, h, 60, 220))
  const at = (x: number, y: number, c: number) => field[(y * w + x) * 4 + c]

  test("clear ground reads as no cloud", () => {
    expect(at(10, 10, 0)).toBe(0)
  })

  test("a bright, cold block reads as full, high cloud", () => {
    expect(at(w / 2, h / 2, 0)).toBe(255)
    expect(at(w / 2, h / 2, 1)).toBe(255)
  })

  test("coverage is carried in alpha", () => {
    expect(at(5, 5, 3)).toBe(255)
  })

  test("a moderately bright cloud is mostly cloud but not high cloud", () => {
    const f = satCloudField(image(w, h, 60, 140))
    expect(f[((h / 2) * w + w / 2) * 4]).toBeGreaterThan(180)
    expect(f[((h / 2) * w + w / 2) * 4 + 1]).toBe(0)
  })

  test("pixels without data stay empty", () => {
    const img = image(w, h, 60, 220)
    const alpha = new Uint8Array(w * h).fill(255)
    const k = 5 * w + 100
    alpha[k] = 0
    const f = satCloudField({ ...img, alpha })
    expect([f[4 * k], f[4 * k + 1], f[4 * k + 2], f[4 * k + 3]]).toEqual([0, 0, 0, 0])
  })

  test("the empty columns the map service leaves at the date line take their neighbours' values (no seam)", () => {
    const img = image(w, h, 60, 220)
    for (let y = 0; y < h; y++) img.gray[y * w + 1] = 220 // a cloud just inside the west edge
    const alpha = new Uint8Array(w * h).fill(255)
    for (let y = 0; y < h; y++) { alpha[y * w] = 0; alpha[y * w + w - 1] = 0 }
    const f = satCloudField({ ...img, alpha })
    const px = (x: number, y: number) => [0, 1, 2, 3].map((c) => f[(y * w + x) * 4 + c])
    expect(px(0, 20)).toEqual(px(1, 20))
    expect(px(w - 1, 20)).toEqual(px(w - 2, 20))
    expect(px(0, 20)[3]).toBe(255)
  })
})
