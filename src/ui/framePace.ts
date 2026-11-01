// Whether the GPU keeps up while the globe moves, judged from the spacing of animation frames: a run of frames mostly
// slow steps the drawing's pixel ratio coarser; runs nearly all quick step it finer again — more patiently each time a
// step finer proved too much, so it settles instead of see-sawing.

/** frames further apart than this are slow (a 60 Hz display paces them 16.7 ms apart, 120 Hz 8.3 ms) */
export const SLOW_FRAME_MS = 24
/** the frames judged together */
export const PACE_RUN = 60
/** quick runs in a row before a step finer (doubled each time a step finer proved too slow) */
export const FAST_RUNS = 3
/** a run with more of its frames slow than this steps coarser; with fewer than QUICK_SHARE, it counts as quick */
const SLOW_SHARE = 0.6
const QUICK_SHARE = 0.05

export interface FramePace {
  /** frames counted in this run, and how many of them were slow */
  readonly n: number
  readonly slow: number
  /** quick runs in a row */
  readonly fast: number
  /** the quick runs needed before a step finer */
  readonly patience: number
  /** the last run stepped finer: a slow run now proves that step too much */
  readonly tried: boolean
}

export const PACE_START: FramePace = { n: 0, slow: 0, fast: 0, patience: FAST_RUNS, tried: false }

/** The pace after one more frame, `gapMs` after the last, and the step to take: −1 coarser, 1 finer, 0 none. A step
 *  finer is taken only where `canFiner`. */
export function paceFrame(p: FramePace, gapMs: number, canFiner: boolean): { pace: FramePace; step: -1 | 0 | 1 } {
  const n = p.n + 1, slow = p.slow + (gapMs > SLOW_FRAME_MS ? 1 : 0)
  if (n < PACE_RUN) return { pace: { ...p, n, slow }, step: 0 }
  if (slow > SLOW_SHARE * n) return { pace: { ...PACE_START, patience: p.tried ? p.patience * 2 : p.patience }, step: -1 }
  const fast = slow < QUICK_SHARE * n ? p.fast + 1 : 0
  if (canFiner && fast >= p.patience) return { pace: { ...PACE_START, patience: p.patience, tried: true }, step: 1 }
  return { pace: { ...PACE_START, patience: p.patience, fast }, step: 0 }
}
