import { describe, expect, test } from "vitest"
import { ageBand, groundEllipse, hitQuake, outerRadiusPx, quakeRadiusPx, ringsFor, QUAKE_AGES } from "../src/globe/quakeView"

const HOUR = 3600_000

describe("a quake's ring", () => {
  test("grows with the magnitude, the strongest held to a size the globe can bear", () => {
    const sizes = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((m) => quakeRadiusPx(m, 1))
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
    expect(quakeRadiusPx(9.5, 1)).toBe(quakeRadiusPx(10, 1))
    expect(quakeRadiusPx(1, 1)).toBe(quakeRadiusPx(2.5, 1))
  })

  test("ripples out like waves from a stone: one ring for a small quake, two from 4.5, three from 6", () => {
    expect([2.5, 4.4, 4.5, 5.9, 6, 7.8].map(ringsFor)).toEqual([1, 1, 2, 2, 3, 3])
    expect(outerRadiusPx(3, 1)).toBe(quakeRadiusPx(3, 1))
    expect(outerRadiusPx(5, 1)).toBeGreaterThan(quakeRadiusPx(5, 1))
    expect(outerRadiusPx(6.5, 1)).toBeGreaterThan(outerRadiusPx(5.9, 1))
  })

  test("grows a little as the globe is zoomed in, not without end", () => {
    expect(quakeRadiusPx(5, 4)).toBeGreaterThan(quakeRadiusPx(5, 1))
    expect(quakeRadiusPx(5, 16)).toBe(quakeRadiusPx(5, 40))
  })

  test("is coloured by its age: the past hour, the past day, the week before", () => {
    expect(QUAKE_AGES.map((a) => a.label)).toEqual(["past hour", "past day", "past week"])
    expect(ageBand(10 * 60_000)).toBe(0)
    expect(ageBand(HOUR)).toBe(1)
    expect(ageBand(23 * HOUR)).toBe(1)
    expect(ageBand(24 * HOUR)).toBe(2)
    expect(ageBand(6 * 24 * HOUR)).toBe(2)
  })

  test("lies on the ground: round in the middle of the globe, foreshortened toward its edge", () => {
    const mid = groundEllipse([0, 0, 1], 10)
    expect(mid.rx).toBeCloseTo(10)
    expect(mid.ry).toBeCloseTo(10)
    // near the right-hand edge it narrows across (along the radius, x), not along the edge
    const edge = groundEllipse([0.98, 0, Math.sqrt(1 - 0.98 ** 2)], 10)
    expect(edge.rx).toBeLessThan(3)
    expect(edge.ry).toBeCloseTo(10)
    expect(edge.angle).toBeCloseTo(0)
    // at the top edge, the radius points up the screen
    expect(Math.abs(groundEllipse([0, 0.98, 0.2], 10).angle)).toBeCloseTo(Math.PI / 2)
    expect(groundEllipse([1, 0, 0], 10).rx).toBeGreaterThan(0)
  })
})

describe("hitQuake", () => {
  const spots = [{ x: 100, y: 100, r: 4 }, { x: 112, y: 100, r: 10 }, { x: 300, y: 300, r: 3 }]

  test("finds the quake under a tap, a small one within the tap's reach", () => {
    expect(hitQuake(spots, 301, 302, 12)).toBe(2)
    expect(hitQuake(spots, 300, 312, 12)).toBe(2)
  })

  test("takes the nearest where rings overlap", () => {
    expect(hitQuake(spots, 101, 100, 6)).toBe(0)
    expect(hitQuake(spots, 113, 101, 6)).toBe(1)
  })

  test("finds none away from every ring", () => {
    expect(hitQuake(spots, 200, 200, 12)).toBe(-1)
    expect(hitQuake([], 0, 0, 12)).toBe(-1)
  })
})
