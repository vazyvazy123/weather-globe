// The wind over the globe: its particles (windParticles.ts) stepped STEPS_PER_S times a second while there is wind to
// show and the page is visible (animation frames stop with a hidden page), drawn on the wind's own canvas (windGl.ts) at
// each step — and whenever the camera moves, so the trails keep to the globe between steps. Under reduced motion the
// trails are drawn still: settled afresh when the wind or the view changes, once the view has rested SETTLE_AFTER_MS.
// Should the GPU drop the canvas's context, the wind stops, and starts again if the context comes back.
import { reducedMotion } from "./camera"
import type { WindFrame } from "./windField"
import { WindGl } from "./windGl"
import { MAX_PARTICLES, SEGMENTS_PER_TRAIL, SEG_FLOATS, WindParticles, type WindCamera, type WindScreen } from "./windParticles"

/** the screen (CSS px) and its device pixels per CSS pixel */
export interface WindGeom extends WindScreen { readonly dpr: number }

const STEPS_PER_S = 30
const STEP_MS = 1000 / STEPS_PER_S
/** between steps the view waits on a timer, asking for no frames, until this long before the next is due: then it asks
 *  for the one frame it steps in (the frame after the wait, at 60 Hz or 120 Hz, falls about a step on) */
const FRAME_SLACK_MS = 6
/** after a step the camera's frame drove, the trails' own next step waits this long: while the globe turns, its next
 *  frame comes first (and steps them), so they are drawn once a frame at any refresh rate */
const AFTER_VIEW_MS = STEP_MS * 1.5
/** the lines' width at a trail's head (CSS px); they thin toward the tail */
const LINE_PX = 1.0
const SETTLE_AFTER_MS = 200

const viewKey = (c: WindCamera, g: WindGeom): string => [c.lon, c.lat, g.w, g.h, g.cx, g.cy, g.r, g.dpr].join(",")

export class WindView {
  private readonly particles = new WindParticles()
  private readonly segs = new Float32Array(MAX_PARTICLES * SEGMENTS_PER_TRAIL * SEG_FLOATS)
  private frame: WindFrame | null = null
  private cam: WindCamera | null = null
  private geom: WindGeom | null = null
  /** the view the still trails were last settled for (reduced motion) */
  private settledFor = ""
  private raf = 0
  private waitTimer = 0
  private lastStep = 0
  private settleTimer = 0

  private constructor(private readonly canvas: HTMLCanvasElement, private gl: WindGl | null) {
    canvas.addEventListener("webglcontextlost", this.lost)
    canvas.addEventListener("webglcontextrestored", this.restored)
  }

  /** null where WebGL2 is unavailable */
  static create(canvas: HTMLCanvasElement): WindView | null {
    const gl = WindGl.create(canvas)
    return gl ? new WindView(canvas, gl) : null
  }

  /** The wind to show; null hides it and stops the steps. */
  setFrame(frame: WindFrame | null): void {
    this.frame = frame
    this.settledFor = ""
    if (!frame) { this.stop(); this.draw(); return }
    if (reducedMotion()) this.settleSoon(0)
    else this.run()
  }

  /** The camera and the screen now: the trails are drawn where they are on the globe as it is seen now. */
  view(cam: WindCamera, geom: WindGeom): void {
    this.cam = { lon: cam.lon, lat: cam.lat }
    this.geom = geom
    if (!this.frame) return
    if (reducedMotion()) {
      this.draw()
      if (viewKey(this.cam, geom) !== this.settledFor) this.settleSoon(SETTLE_AFTER_MS)
      return
    }
    // the trails step and are drawn with the globe's frame, their own steps held off while the frames come: one drawing a
    // frame while the globe turns, not the globe's and the steps' both
    const running = this.raf !== 0 || this.waitTimer !== 0
    this.stop()
    if (!running) this.lastStep = performance.now()
    this.step(performance.now(), AFTER_VIEW_MS)
  }

  dispose(): void {
    this.stop()
    this.canvas.removeEventListener("webglcontextlost", this.lost)
    this.canvas.removeEventListener("webglcontextrestored", this.restored)
    this.gl?.dispose()
    this.gl = null
  }

  private readonly lost = (e: Event): void => {
    e.preventDefault()
    this.stop()
    this.gl = null
  }

  private readonly restored = (): void => {
    this.gl = WindGl.create(this.canvas)
    if (!this.frame) return
    this.settledFor = ""
    if (reducedMotion()) this.settleSoon(0)
    else this.run()
  }

  private run(): void {
    if (this.raf || this.waitTimer || !this.gl || !this.frame || !this.cam || !this.geom) return
    this.lastStep = performance.now()
    this.raf = window.requestAnimationFrame(this.tick)
  }

  private stop(): void {
    if (this.raf) window.cancelAnimationFrame(this.raf)
    this.raf = 0
    window.clearTimeout(this.waitTimer)
    this.waitTimer = 0
    window.clearTimeout(this.settleTimer)
  }

  private readonly tick = (now: number): void => { this.step(now, STEP_MS - FRAME_SLACK_MS) }

  /** One step of the trails, drawn; the next asked for `nextInMs` from now. */
  private step(now: number, nextInMs: number): void {
    this.raf = 0
    const { frame, cam, geom } = this
    if (!this.gl || !frame || !cam || !geom) return
    this.particles.step(frame, cam, geom, Math.min(0.1, (now - this.lastStep) / 1000))
    this.lastStep = now
    this.draw()
    this.waitTimer = window.setTimeout(() => { this.waitTimer = 0; this.raf = window.requestAnimationFrame(this.tick) }, nextInMs)
  }

  private settleSoon(ms: number): void {
    window.clearTimeout(this.settleTimer)
    this.settleTimer = window.setTimeout(() => {
      const { frame, cam, geom } = this
      if (!this.gl || !frame || !cam || !geom) return
      this.particles.settle(frame, cam, geom)
      this.settledFor = viewKey(cam, geom)
      this.draw()
    }, ms)
  }

  private draw(): void {
    const g = this.geom
    if (!this.gl || !g) return
    const w = Math.max(1, Math.round(g.w * g.dpr)), h = Math.max(1, Math.round(g.h * g.dpr))
    const n = this.frame && this.cam ? this.particles.segments(this.cam, g, g.dpr, this.segs) : 0
    this.gl.draw(this.segs, n, w, h, LINE_PX * g.dpr)
  }
}
