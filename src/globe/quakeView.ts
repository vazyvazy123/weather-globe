// The earthquakes on the globe (quakes.ts): a ring lying on the ground at each, sized by its magnitude and coloured by
// its age — red for the past hour, orange for the past day, a pale gold for the week before — drawn on a 2D canvas of
// their own over the globe whenever the camera moves (layout, Globe.tsx). The rings of one colour go in one path,
// filled and stroked once, so some 600 of them cost a frame little; the freshest are drawn over the older. Where each
// ring was drawn is kept, for a tap to find it (hitQuake) and for the rings that pulse round the newest (Globe.tsx).
import type { Quake } from "../data/quakes"
import { cameraMatrix, toCamera, type WindCamera } from "./windParticles"

const HOUR = 3600_000
const RAD = Math.PI / 180

/** the age bands, newest first: a quake is in the first whose span it is within */
export const QUAKE_AGES = [
  { label: "past hour", maxMs: HOUR, rgb: "255, 84, 84", fill: 0.55, line: 1 },
  { label: "past day", maxMs: 24 * HOUR, rgb: "255, 152, 72", fill: 0.45, line: 0.95 },
  { label: "past week", maxMs: Infinity, rgb: "246, 212, 128", fill: 0.3, line: 0.75 },
] as const

/** a ring's radius (CSS px) at the weakest magnitude shown, growing GROWTH times with each step of magnitude */
const BASE_PX = 2.8
const GROWTH = 1.55
const MIN_MAG = 2.5
const MAX_PX = 30
/** zoomed in, the rings grow a little, up to ZOOM_GROW_MAX times */
const ZOOM_GROW = 0.1
const ZOOM_GROW_MAX = 1.8
/** a ring at the globe's edge is foreshortened no thinner than this, so it still shows */
const MIN_TILT = 0.12
/** behind the horizon from this close (as in Globe.tsx) */
const HORIZON_Z = 0.02
/** quakes this strong get a second, wider ring */
const STRONG_MAG = 6
const STRONG_RING = 1.7
const CHOSEN_RING = 1.45
const CHOSEN_COLOR = "rgba(244, 185, 66, 0.95)"

export const ageBand = (ageMs: number): number => QUAKE_AGES.findIndex((a) => ageMs < a.maxMs)

/** A quake's ring radius (CSS px) at the camera's zoom. */
export function quakeRadiusPx(mag: number, zoom: number): number {
  const base = Math.min(MAX_PX, BASE_PX * GROWTH ** (Math.max(MIN_MAG, mag) - MIN_MAG))
  return base * Math.min(ZOOM_GROW_MAX, 1 + Math.max(0, zoom - 1) * ZOOM_GROW)
}

/** A ring lying on the ground where the globe's unit vector is `C` (camera frame: x right, y up, z toward the viewer),
 *  as the screen sees it: `ry` along the horizon's direction, `rx` along the radius from the globe's middle (at `angle`
 *  from the screen's x axis), foreshortened by the tilt of the ground there. */
export function groundEllipse(C: readonly [number, number, number], rPx: number): { rx: number; ry: number; angle: number } {
  return { rx: rPx * Math.max(MIN_TILT, C[2]), ry: rPx, angle: Math.atan2(-C[1], C[0]) }
}

export interface QuakeSpot { readonly x: number; readonly y: number; readonly r: number }

/** The ring a tap at (x, y) is on, or within `slopPx` of (a small ring is hard to hit): the nearest; -1 for none. */
export function hitQuake(spots: readonly QuakeSpot[], x: number, y: number, slopPx: number): number {
  let best = -1, bestD = Infinity
  spots.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.y - y)
    if (d <= Math.max(s.r, slopPx) && d < bestD) { best = i; bestD = d }
  })
  return best
}

/** the screen: its size (CSS px), the globe's middle and radius on it, and device pixels per CSS pixel */
export interface QuakeGeom { readonly w: number; readonly h: number; readonly cx: number; readonly cy: number; readonly r: number; readonly dpr: number }

export class QuakeView {
  private readonly ctx: CanvasRenderingContext2D | null
  private quakes: readonly Quake[] = []
  /** each quake's place as a unit vector (x toward 0° on the equator, y toward 90°E, z north) */
  private vecs = new Float64Array(0)
  private spots: QuakeSpot[] = []
  private spotIds: string[] = []
  private readonly where = new Map<string, readonly [number, number]>()

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")
  }

  setQuakes(quakes: readonly Quake[]): void {
    this.quakes = quakes
    this.vecs = new Float64Array(quakes.length * 3)
    quakes.forEach((q, i) => {
      const la = q.lat * RAD, lo = q.lon * RAD
      this.vecs.set([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], i * 3)
    })
  }

  /** The rings for the camera and the screen now, as of `nowMs`; `chosen` (a quake's id) ringed in gold. */
  draw(cam: WindCamera & { readonly zoom: number }, g: QuakeGeom, nowMs: number, chosen: string | null): void {
    const ctx = this.ctx
    this.spots = []
    this.spotIds = []
    this.where.clear()
    if (!ctx) return
    // with no quakes to show, the canvas keeps no full-size picture
    if (this.quakes.length === 0) {
      if (this.canvas.width !== 1 || this.canvas.height !== 1) { this.canvas.width = 1; this.canvas.height = 1 }
      return
    }
    const W = Math.max(1, Math.round(g.w * g.dpr)), H = Math.max(1, Math.round(g.h * g.dpr))
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0)
    const m = cameraMatrix(cam)
    const bands = QUAKE_AGES.map(() => new Path2D()), strong = new Path2D(), ring = new Path2D()
    const ellipse = (p: Path2D, x: number, y: number, rx: number, ry: number, angle: number) => {
      p.moveTo(x + rx * Math.cos(angle), y + rx * Math.sin(angle))
      p.ellipse(x, y, rx, ry, angle, 0, 2 * Math.PI)
    }
    this.quakes.forEach((q, i) => {
      const C = toCamera(m, this.vecs[i * 3], this.vecs[i * 3 + 1], this.vecs[i * 3 + 2])
      if (C[2] <= HORIZON_Z) return
      const rad = quakeRadiusPx(q.mag, cam.zoom), x = g.cx + g.r * C[0], y = g.cy - g.r * C[1]
      if (x < -rad || x > g.w + rad || y < -rad || y > g.h + rad) return
      const e = groundEllipse(C, rad)
      ellipse(bands[ageBand(nowMs - q.timeMs)], x, y, e.rx, e.ry, e.angle)
      if (q.mag >= STRONG_MAG) ellipse(strong, x, y, e.rx * STRONG_RING, e.ry * STRONG_RING, e.angle)
      if (q.id === chosen) ellipse(ring, x, y, e.rx * CHOSEN_RING + 3, e.ry * CHOSEN_RING + 3, e.angle)
      this.spots.push({ x, y, r: rad })
      this.spotIds.push(q.id)
      this.where.set(q.id, [x, y])
    })
    // the oldest first, the freshest over them; overlapping rings of one colour fill once, never darkening each other
    ctx.lineWidth = 1
    for (let b = QUAKE_AGES.length - 1; b >= 0; b--) {
      const a = QUAKE_AGES[b]
      ctx.fillStyle = `rgba(${a.rgb}, ${a.fill})`
      ctx.fill(bands[b])
      ctx.strokeStyle = `rgba(${a.rgb}, ${a.line})`
      ctx.stroke(bands[b])
    }
    ctx.strokeStyle = "rgba(255, 236, 214, 0.55)"
    ctx.stroke(strong)
    ctx.lineWidth = 2
    ctx.strokeStyle = CHOSEN_COLOR
    ctx.stroke(ring)
  }

  /** The quake a tap at (x, y; CSS px over the globe) is on, from the last drawing; null for none. */
  hit(x: number, y: number, slopPx: number): string | null {
    const k = hitQuake(this.spots, x, y, slopPx)
    return k < 0 ? null : this.spotIds[k]
  }

  /** Where a quake was drawn last (CSS px); null where it was not (behind the globe, off the screen). */
  at(id: string): readonly [number, number] | null {
    return this.where.get(id) ?? null
  }
}
