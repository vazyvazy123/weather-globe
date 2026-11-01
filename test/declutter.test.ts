import { describe, expect, test } from "vitest"
import { spreadMarkers } from "../src/globe/declutter"

const pt = (x: number, y: number) => ({ x, y })

describe("spreadMarkers", () => {
  test("markers far apart all show", () => {
    expect(spreadMarkers([pt(0, 0), pt(100, 0), pt(0, 100)], 15)).toEqual([true, true, true])
  })

  test("a marker too close to one already kept is left out, the first one given wins", () => {
    expect(spreadMarkers([pt(50, 50), pt(58, 52), pt(80, 50)], 15)).toEqual([true, false, true])
  })

  test("a marker left out never blocks the ones after it", () => {
    // b is too close to a; c is close to b but not to a, so c shows
    expect(spreadMarkers([pt(0, 0), pt(10, 0), pt(20, 0)], 15)).toEqual([true, false, true])
  })

  test("closeness is the straight-line distance, across grid cells", () => {
    expect(spreadMarkers([pt(14.9, 14.9), pt(15.1, 15.1)], 15)).toEqual([true, false])
    expect(spreadMarkers([pt(0, 0), pt(11, 11)], 15)).toEqual([true, true])
  })

  test("negative coordinates (just off the frame) work", () => {
    expect(spreadMarkers([pt(-20, -20), pt(-12, -18), pt(-40, -20)], 15)).toEqual([true, false, true])
  })

  test("a forced marker shows even when crowded, and still blocks later ones", () => {
    expect(spreadMarkers([pt(0, 0), pt(5, 0), pt(9, 0)], 15, [false, true, false])).toEqual([true, true, false])
  })

  test("a dense cluster keeps a spaced-out subset", () => {
    const cluster = Array.from({ length: 100 }, (_, k) => pt((k % 10) * 5, Math.floor(k / 10) * 5))
    const kept = spreadMarkers(cluster, 15)
    const shown = cluster.filter((_, k) => kept[k])
    expect(shown.length).toBeGreaterThan(4)
    expect(shown.length).toBeLessThan(20)
    for (const a of shown) for (const b of shown) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(15)
  })
})
