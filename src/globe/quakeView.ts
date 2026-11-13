// The earthquakes on the globe (quakes.ts), each a ripple lying on the ground, like the waves from a stone dropped in
// water: a bright epicentre, a faint disk, and rings round it — one for a small quake, two from magnitude 4.5, three
// from 6, each fainter than the one inside it — over a soft glow from magnitude 5. Sized by the magnitude, coloured by
// the age: red for the past hour, orange for the past day, a pale gold for the week before. Drawn on a 2D canvas of
// their own over the globe whenever the camera moves (layout, Globe.tsx): the shapes of one colour go in one path,
// filled or stroked once, and the glows are one small picture stretched onto the ground, so some 600 quakes cost a frame
// little; the freshest are drawn over the older. Where each was drawn is kept, for a tap to find it (hitQuake) and for
// the rings that pulse round the newest (Globe.tsx).
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

/** the inner ring's radius (CSS px) at the weakest magnitude shown, growing GROWTH times with each step of magnitude */
const BASE_PX = 3
const GROWTH = 1.42
const MIN_MAG = 2.5
const MAX_PX = 22
/** each further ring this much of the inner one's radius beyond the last */
const RING_SPREAD = 0.75
/** the epicentre's dot, as a share of the inner ring (and no smaller than DOT_MIN_PX) */
const DOT_SHARE = 0.3
const DOT_MIN_PX = 1.2
/** quakes this strong glow, over this many inner radii */
const GLOW_MAG = 5
const GLOW_SPAN = 2.8
const GLOW_SPRITE_PX = 64
/** a tap finds a quake within this many inner radii of it (or its outer ring, if nearer) */
const TAP_SPAN = 1.75
/** zoomed in, the rings grow a little, up to ZOOM_GROW_MAX times */
const ZOOM_GROW = 0.1
const ZOOM_GROW_MAX = 1.8
/** a ring at the globe's edge is foreshortened no thinner than this, so it still shows */
const MIN_TILT = 0.12
/** behind the horizon from this close (as in Globe.tsx) */
const HORIZON_Z = 0.02
/** the chosen quake's gold ring, this far beyond its outer ring */
const CHOSEN_RING = 1.25
const CHOSEN_COLOR = "rgba(244, 185, 66, 0.95)"
const MAX_RINGS = 3

export const ageBand = (ageMs: number): number => QUAKE_AGES.findIndex((a) => ageMs < a.maxMs)

/** A quake's inner ring radius (CSS px) at the camera's zoom. */
export function quakeRadiusPx(mag: number, zoom: number): number {
  const base = Math.min(MAX_PX, BASE_PX * GROWTH ** (Math.max(MIN_MAG, mag) - MIN_MAG))
  return base * Math.min(ZOOM_GROW_MAX, 1 + Math.max(0, zoom - 1) * ZOOM_GROW)
}

/** How many rings ripple round a quake. */
export const ringsFor = (mag: number): number => (mag >= 6 ? 3 : mag >= 4.5 ? 2 : 1)

/** The radius (CSS px) of a quake's outer ring: how far it reaches, for a tap and for being on the screen at all. */
export const outerRadiusPx = (mag: number, zoom: number): number => quakeRadiusPx(mag, zoom) * (1 + RING_SPREAD * (ringsFor(mag) - 1))

/** A soft round glow in an age's colour, drawn once and stretched onto the ground for each strong quake. */
function glowSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = c.height = GLOW_SPRITE_PX
  const g = c.getContext("2d"), h = GLOW_SPRITE_PX / 2
  if (!g) return c
  const grad = g.createRadialGradient(h, h, 0, h, h, h)
  grad.addColorStop(0, `rgba(${rgb}, 0.55)`)
  grad.addColorStop(0.4, `rgba(${rgb}, 0.18)`)
  grad.addColorStop(1, `rgba(${rgb}, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX)
  return c
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
  /** each age's glow, made the first time one is drawn */
  private glows: HTMLCanvasElement[] | null = null

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
    // per age: the disks, the dots, and the rings by how far out; the glows to stretch; the chosen quake's gold ring
    const disks = QUAKE_AGES.map(() => new Path2D()), dots = QUAKE_AGES.map(() => new Path2D())
    const rings = QUAKE_AGES.map(() => Array.from({ length: MAX_RINGS }, () => new Path2D()))
    const glowsAt: Array<{ band: number; x: number; y: number; rx: number; ry: number; angle: number }> = []
    const chosenRing = new Path2D()
    const ellipse = (p: Path2D, x: number, y: number, rx: number, ry: number, angle: number) => {
      p.moveTo(x + rx * Math.cos(angle), y + rx * Math.sin(angle))
      p.ellipse(x, y, rx, ry, angle, 0, 2 * Math.PI)
    }
    this.quakes.forEach((q, i) => {
      const C = toCamera(m, this.vecs[i * 3], this.vecs[i * 3 + 1], this.vecs[i * 3 + 2])
      if (C[2] <= HORIZON_Z) return
      const rad = quakeRadiusPx(q.mag, cam.zoom), n = ringsFor(q.mag), outer = rad * (1 + RING_SPREAD * (n - 1))
      const x = g.cx + g.r * C[0], y = g.cy - g.r * C[1]
      // (on the screen while any of it is: its glow reaches furthest)
      const reach = q.mag >= GLOW_MAG ? Math.max(outer, rad * GLOW_SPAN) : outer
      if (x < -reach || x > g.w + reach || y < -reach || y > g.h + reach) return
      const band = ageBand(nowMs - q.timeMs), e = groundEllipse(C, 1), tilt = e.rx
      const at = (r: number, p: Path2D) => ellipse(p, x, y, r * tilt, r, e.angle)
      if (q.mag >= GLOW_MAG) glowsAt.push({ band, x, y, rx: rad * GLOW_SPAN * tilt, ry: rad * GLOW_SPAN, angle: e.angle })
      at(rad, disks[band])
      for (let k = 0; k < n; k++) at(rad * (1 + RING_SPREAD * k), rings[band][k])
      at(Math.max(DOT_MIN_PX, rad * DOT_SHARE), dots[band])
      if (q.id === chosen) at(outer * CHOSEN_RING + 3, chosenRing)
      // a tap finds it within its rings, but a strong quake's wide ripples catch no tap far out in the empty sea
      this.spots.push({ x, y, r: Math.min(outer, rad * TAP_SPAN) })
      this.spotIds.push(q.id)
      this.where.set(q.id, [x, y])
    })
    // the oldest first, the freshest over them; overlapping shapes of one colour fill once, never darkening each other
    if (glowsAt.length) {
      const sprites = (this.glows ??= QUAKE_AGES.map((a) => glowSprite(a.rgb))), h = GLOW_SPRITE_PX / 2
      for (let b = QUAKE_AGES.length - 1; b >= 0; b--) {
        for (const s of glowsAt) {
          if (s.band !== b) continue
          const cs = Math.cos(s.angle), sn = Math.sin(s.angle), sx = (s.rx / h) * g.dpr, sy = (s.ry / h) * g.dpr
          ctx.setTransform(cs * sx, sn * sx, -sn * sy, cs * sy, s.x * g.dpr, s.y * g.dpr)
          ctx.drawImage(sprites[b], -h, -h)
        }
      }
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0)
    }
    for (let b = QUAKE_AGES.length - 1; b >= 0; b--) {
      const a = QUAKE_AGES[b]
      ctx.fillStyle = `rgba(${a.rgb}, ${a.fill * 0.6})`
      ctx.fill(disks[b])
      for (let k = 0; k < MAX_RINGS; k++) {
        ctx.lineWidth = k === 0 ? 1.2 : 1
        ctx.strokeStyle = `rgba(${a.rgb}, ${a.line * (1 - 0.3 * k)})`
        ctx.stroke(rings[b][k])
      }
      ctx.fillStyle = `rgba(${a.rgb}, 1)`
      ctx.fill(dots[b])
    }
    ctx.lineWidth = 2
    ctx.strokeStyle = CHOSEN_COLOR
    ctx.stroke(chosenRing)
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
