// Where each city's label pill goes on the globe: beside its marker on the right, else on the left, else below — the
// first side where the pill covers no other city's marker, no pill already placed and nothing else kept clear; none
// when every side is taken (zoom in to see it). Cities are placed in the order given,
// the most important first. Screen pixels. Pure.
// Given where the labels were a moment ago, it holds them steady as the globe turns and zooms: a label keeps its side
// while it still fits with KEEP_PX to spare the other way, and a label not shown appears only once it fits with NEW_PX
// to spare — so a label on the edge of fitting does not flicker in and out.

export type LabelSide = "right" | "left" | "below"
export type LabelBox = [number, number, number, number] // left, top, right, bottom
type Box = LabelBox

export const LABEL_GAP_PX = 5
export const PILL_H = 21

export interface LabelItem {
  /** the city's ground point */
  x: number
  y: number
  /** the marker drawn there (its ring), relative to the ground point */
  marker: Box
  /** the pill's width */
  w: number
}

/** The width of a pill, a little generous so the text always fits: the city's name (12 px semibold), then the
 *  temperature chip (10 px mono). */
export function pillWidth(name: string, temp: string | null, extraPx = 0): number {
  const chip = (s: string | null) => (s ? 5 + s.length * 6.4 + 6 : 0)
  return Math.round(20 + name.length * 7.3 + chip(temp) + extraPx)
}

/** The width of a city's compact label, its temperature alone (10 px mono), for where the full pill has no room. */
export function chipWidth(temp: string): number {
  return Math.round(14 + temp.length * 6.4)
}

/** The pill's box on a side, relative to the ground point. */
export function pillBox(side: LabelSide, it: Pick<LabelItem, "marker" | "w">): Box {
  const [ml, mt, mr, mb] = it.marker
  const midY = Math.min((mt + mb) / 2, 0)
  if (side === "right") return [mr + LABEL_GAP_PX, midY - PILL_H / 2, mr + LABEL_GAP_PX + it.w, midY + PILL_H / 2]
  if (side === "left") return [ml - LABEL_GAP_PX - it.w, midY - PILL_H / 2, ml - LABEL_GAP_PX, midY + PILL_H / 2]
  return [-it.w / 2, mb + LABEL_GAP_PX, it.w / 2, mb + LABEL_GAP_PX + PILL_H]
}

const SIDES: readonly LabelSide[] = ["right", "left", "below"]
/** a label already shown may crowd its neighbours this much before it moves or goes; a new one needs this much room */
export const KEEP_PX = 4
export const NEW_PX = 3
const overlap = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
const at = (b: Box, x: number, y: number): Box => [x + b[0], y + b[1], x + b[2], y + b[3]]
const grow = (b: Box, d: number): Box => [b[0] - d, b[1] - d, b[2] + d, b[3] + d]

export interface LabelViewport { width: number; height: number; reserveBottom?: number }

/** `prev` (one per item, when given): the side each label had a moment ago, null where it had none. */
export function placeLabels(items: readonly LabelItem[], blocked: readonly Box[] = [], prev?: ReadonlyArray<LabelSide | null | undefined>, viewport?: LabelViewport): Array<LabelSide | null> {
  const markers = items.map((it) => at(it.marker, it.x, it.y))
  const placed: Box[] = []
  const bottom = Math.max(0, viewport ? viewport.height - (viewport.reserveBottom ?? 0) : 0)
  const visible = (b: Box) => !viewport || (b[0] >= 0 && b[1] >= 0 && b[2] <= viewport.width && b[3] <= bottom)
  const free = (b: Box, i: number) => !markers.some((m, j) => j !== i && overlap(b, m)) && !placed.some((p) => overlap(b, p)) && !blocked.some((p) => overlap(b, p))
  return items.map((it, i) => {
    const before = prev?.[i]
    if (before) {
      const b = at(pillBox(before, it), it.x, it.y)
      if (visible(b) && free(grow(b, -KEEP_PX), i)) { placed.push(b); return before }
    }
    for (const side of SIDES) {
      const b = at(pillBox(side, it), it.x, it.y)
      if (!visible(b) || !free(prev ? grow(b, NEW_PX) : b, i)) continue
      placed.push(b)
      return side
    }
    return null
  })
}
