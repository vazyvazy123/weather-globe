import { describe, expect, test } from "vitest"
import { CallBudget } from "../src/data/meteoBudget"

describe("CallBudget", () => {
  test("calls that fit in the last minute's room go at once", () => {
    const b = new CallBudget(560)
    b.spend(300, 0)
    expect(b.waitFor(200, 1_000)).toBe(0)
  })

  test("calls that do not fit wait for the oldest calls that make room to age out", () => {
    const b = new CallBudget(560)
    b.spend(400, 0)
    b.spend(100, 10_000)
    expect(b.waitFor(200, 20_000)).toBe(40_000)
  })

  test("calls older than a minute no longer count", () => {
    const b = new CallBudget(560)
    b.spend(560, 0)
    expect(b.waitFor(100, 59_000)).toBeGreaterThan(0)
    expect(b.waitFor(100, 60_000)).toBe(0)
  })

  test("a request larger than the whole budget waits only for an empty minute", () => {
    const b = new CallBudget(100)
    expect(b.waitFor(500, 0)).toBe(0)
    b.spend(50, 0)
    expect(b.waitFor(500, 1_000)).toBe(59_000)
  })
})
