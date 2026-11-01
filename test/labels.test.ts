import { describe, expect, test } from "vitest"
import { chipWidth, pillBox, pillWidth, placeLabels, type LabelItem } from "../src/globe/labels"

const item = (x: number, y: number, w = 60): LabelItem => ({ x, y, w, marker: [-5, -5, 5, 5] })

describe("placeLabels", () => {
  test("a lone label goes on the right", () => {
    expect(placeLabels([item(100, 100)])).toEqual(["right"])
  })

  test("a label that would cover another's marker moves to a free side", () => {
    const sides = placeLabels([item(100, 100), item(170, 100)])
    expect(sides[0]).toBe("left")
    expect(sides[1]).toBe("right")
  })

  test("a label off the frame is not shown", () => {
    expect(placeLabels([item(795, 595)], [], undefined, { width: 800, height: 600 })).toEqual([null])
  })

  test("a label keeps the side it had while it still fits", () => {
    expect(placeLabels([item(100, 100)], [], ["left"])).toEqual(["left"])
  })

  test("pill boxes sit beside the marker", () => {
    const b = pillBox("right", item(0, 0, 50))
    expect(b[0]).toBeGreaterThan(5)
    expect(b[2] - b[0]).toBe(50)
    expect(pillWidth("Tokyo", "20°C")).toBeGreaterThan(pillWidth("Tokyo", null))
    expect(pillWidth("Tokyo", "20°C", 14)).toBe(pillWidth("Tokyo", "20°C") + 14)
  })

  test("a compact chip is much narrower than the full pill", () => {
    expect(chipWidth("20°")).toBeLessThan(pillWidth("Tokyo", "20°C") / 2)
    expect(chipWidth("-12°")).toBeGreaterThan(chipWidth("2°"))
  })

  test("a compact chip fits where the full pill is blocked", () => {
    // something already placed just beyond a chip on the right, and to the left and below: room for a chip, not for the pill
    const blocked: Array<[number, number, number, number]> = [[150, 80, 200, 120], [0, 80, 60, 120], [80, 112, 120, 140]]
    expect(placeLabels([item(100, 100, 120)], blocked)).toEqual([null])
    expect(placeLabels([item(100, 100, chipWidth("20°"))], blocked)).toEqual(["right"])
  })
})
