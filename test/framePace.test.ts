import { describe, expect, test } from "vitest"
import { FAST_RUNS, PACE_RUN, PACE_START, paceFrame, type FramePace } from "../src/ui/framePace"

/** `count` frames `gapMs` apart: the pace after them and the steps taken on the way */
function run(p: FramePace, gapMs: number, count = PACE_RUN, canFiner = true): { pace: FramePace; steps: number[] } {
  const steps: number[] = []
  for (let k = 0; k < count; k++) {
    const next = paceFrame(p, gapMs, canFiner)
    p = next.pace
    if (next.step) steps.push(next.step)
  }
  return { pace: p, steps }
}

describe("paceFrame", () => {
  test("frames that keep a 60 Hz pace take no step coarser", () => {
    expect(run(PACE_START, 16.7, PACE_RUN * 2, false).steps).toEqual([])
  })

  test("a run of frames mostly slow steps coarser once, at the end of the run", () => {
    expect(run(PACE_START, 40, PACE_RUN - 1).steps).toEqual([])
    expect(run(PACE_START, 40).steps).toEqual([-1])
  })

  test("a few slow frames in a run (a tile upload, a hitch) take no step", () => {
    let p = PACE_START
    for (let k = 0; k < PACE_RUN; k++) {
      const next = paceFrame(p, k % 4 === 0 ? 60 : 16.7, false)
      p = next.pace
      expect(next.step).toBe(0)
    }
  })

  test("the threshold sits between a 60 Hz frame and a 30 Hz one", () => {
    expect(paceFrame(PACE_START, 16.7, true).pace.slow).toBe(0)
    expect(paceFrame(PACE_START, 33, true).pace.slow).toBe(1)
  })

  test("after FAST_RUNS quick runs it steps finer again", () => {
    expect(run(PACE_START, 16.7, PACE_RUN * FAST_RUNS).steps).toEqual([1])
  })

  test("it steps finer only where it can", () => {
    expect(run(PACE_START, 16.7, PACE_RUN * FAST_RUNS * 2, false).steps).toEqual([])
  })

  test("a step finer that proves too slow doubles the patience before the next", () => {
    const up = run(PACE_START, 16.7, PACE_RUN * FAST_RUNS)
    expect(up.steps).toEqual([1])
    const down = run(up.pace, 40)
    expect(down.steps).toEqual([-1])
    expect(down.pace.patience).toBe(FAST_RUNS * 2)
    expect(run(down.pace, 16.7, PACE_RUN * FAST_RUNS).steps).toEqual([])
    expect(run(down.pace, 16.7, PACE_RUN * FAST_RUNS * 2).steps).toEqual([1])
  })

  test("a slow run long after a step finer that held does not double the patience", () => {
    const up = run(PACE_START, 16.7, PACE_RUN * FAST_RUNS)
    const held = run(up.pace, 20)
    expect(held.steps).toEqual([])
    expect(run(held.pace, 40).pace.patience).toBe(FAST_RUNS)
  })

  test("the state given is left as it was", () => {
    const p = { ...PACE_START }
    paceFrame(p, 40, true)
    expect(p).toEqual(PACE_START)
  })
})
