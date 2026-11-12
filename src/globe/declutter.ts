// Which city markers show where many crowd together: in the order given (the most important first), a marker shows only
// when no marker already shown lies within `minPx` of it, so a dense region thins to an even spread of its most
// important cities and fills in as you zoom. A forced marker (the selected city, the one playing) always shows. The
// shown markers are kept in a grid of `minPx` cells, so the cost grows with the number of cities, not its square.
// Screen pixels. Pure.

export interface ScreenPoint { x: number; y: number }

/** a marker shown a moment ago keeps its place down to this share of `minPx`, so one on the edge of fitting does not
 *  flicker in and out as the globe turns */
export const KEEP_SHARE = 0.65

/** `kept`: the markers shown a moment ago */
export function spreadMarkers(points: readonly ScreenPoint[], minPx: number, forced?: readonly boolean[], kept?: readonly boolean[]): boolean[] {
  const cells = new Map<string, ScreenPoint[]>()
  const cellOf = (v: number) => Math.floor(v / minPx)
  const crowded = (p: ScreenPoint, min2: number): boolean => {
    const ci = cellOf(p.x), cj = cellOf(p.y)
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const q of cells.get(`${i},${j}`) ?? []) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < min2) return true
      }
    }
    return false
  }
  return points.map((p, k) => {
    const min = kept?.[k] ? minPx * KEEP_SHARE : minPx
    if (!forced?.[k] && crowded(p, min * min)) return false
    const key = `${cellOf(p.x)},${cellOf(p.y)}`
    const cell = cells.get(key)
    if (cell) cell.push(p)
    else cells.set(key, [p])
    return true
  })
}
