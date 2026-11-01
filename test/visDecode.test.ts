import { describe, expect, test } from "vitest"
import { visibleClouds } from "../src/globe/visDecode"

// the March equinox at noon UTC: the sun is overhead near 0°, 0°
const NOON = Date.UTC(2026, 2, 20, 12)
const W = 120, H = 120, RES = 0.05

function picture(fill: (x: number, y: number) => number, covered: (x: number, y: number) => boolean = () => true) {
  const gray = new Uint8Array(W * H), alpha = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { gray[y * W + x] = fill(x, y); alpha[y * W + x] = covered(x, y) ? 255 : 0 }
  return { gray, alpha }
}
const at = (a: Uint8Array, x: number, y: number) => a[y * W + x]

describe("visibleClouds", () => {
  test("bright cloud over dark sea is cloud; the sea is not", () => {
    const { gray, alpha } = picture((x) => (x >= 60 && x < 75 ? 220 : 22))
    const { cloud, trust } = visibleClouds(gray, alpha, W, H, { west: -3, north: 3, res: RES, timeMs: NOON })
    expect(at(cloud, 66, 60)).toBeGreaterThan(200)
    expect(at(cloud, 20, 60)).toBe(0)
    expect(at(trust, 20, 60)).toBe(255)
  })

  test("thin cloud beside clear sea is partly cloud, thicker cloud more: the texture is kept", () => {
    // stripes of sea, thin cloud and thicker cloud, every block holding some of each
    const { gray, alpha } = picture((x) => [22, 70, 130][x % 3])
    const { cloud } = visibleClouds(gray, alpha, W, H, { west: -3, north: 3, res: RES, timeMs: NOON })
    const sea = at(cloud, 60, 60), thin = at(cloud, 61, 60), thick = at(cloud, 62, 60)
    expect(sea).toBe(0)
    expect(thin).toBeGreaterThan(0)
    expect(thick).toBeGreaterThan(thin)
    expect(thick).toBeLessThan(255)
  })

  test("a block wholly overcast still reads as cloud (the clear level is capped)", () => {
    const { gray, alpha } = picture(() => 230)
    const { cloud } = visibleClouds(gray, alpha, W, H, { west: -3, north: 3, res: RES, timeMs: NOON })
    expect(at(cloud, 60, 60)).toBeGreaterThan(200)
  })

  test("where the picture has no data, nothing is trusted", () => {
    const { gray, alpha } = picture(() => 200, (x) => x < 60)
    const { cloud, trust } = visibleClouds(gray, alpha, W, H, { west: -3, north: 3, res: RES, timeMs: NOON })
    expect(at(trust, 90, 60)).toBe(0)
    expect(at(cloud, 90, 60)).toBe(0)
    expect(at(trust, 30, 60)).toBe(255)
  })

  test("by night the picture is not trusted at all", () => {
    const { gray, alpha } = picture(() => 200)
    const { cloud, trust } = visibleClouds(gray, alpha, W, H, { west: 177, north: 3, res: RES, timeMs: NOON })
    expect(Math.max(...trust)).toBe(0)
    expect(Math.max(...cloud)).toBe(0)
  })
})
