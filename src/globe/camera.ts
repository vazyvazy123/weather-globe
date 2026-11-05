// The globe's camera, kept outside React: a drag, the wheel, a fly-to, the world tour or a follow moves it many times a
// second and the globe redraws straight from it (Globe.tsx subscribes), so React renders only when something else
// changes. The tour turns the globe eastward like the Earth at TOUR_DEG_PER_S, timed by the frames' clock; a follow keeps
// the camera over a moving target (the ISS), easing onto it first, the zoom left to the user. Both move it at most every
// MOTION_FRAME_MS: slow motion is as smooth at 30 frames a second, at half or a quarter of the display's frames (and the
// power). Under reduced motion a fly-to jumps, the tour shows a still, whole globe, and a follow only goes there.
// Animation frames stop while the window is hidden.

/** where the globe looks from, and how close: zoom 1 = the whole globe in the frame */
export interface GlobeCamera { lon: number; lat: number; zoom: number }

export const ZOOM_MIN = 1
/** close enough to see the land at its picture's own resolution (~500 m) */
export const ZOOM_MAX = 16
/** one turn in ~90 s */
export const TOUR_DEG_PER_S = 4
const TOUR_VIEW = { lat: 18, zoom: 1 }
const FLY_MS = 650
/** the tour and a follow move the camera at most this often (ms; a little early, for a frame's jitter) */
const MOTION_FRAME_MS = 1000 / 30
const FRAME_JITTER_MS = 2

const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180
export const clampLat = (lat: number): number => Math.max(-70, Math.min(70, lat))

/** The camera `t` (0..1) of the way from `a` to `b`, turning the short way round in longitude. */
export function cameraBetween(a: GlobeCamera, b: GlobeCamera, t: number): GlobeCamera {
  let dl = b.lon - a.lon
  if (dl > 180) dl -= 360
  else if (dl < -180) dl += 360
  return { lon: wrapLon(a.lon + dl * t), lat: a.lat + (b.lat - a.lat) * t, zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) }
}

export function zoomed(c: GlobeCamera, factor: number): GlobeCamera {
  return { ...c, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * factor)) }
}

/** The viewer asked for less motion. */
export const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

export class GlobeCameraController {
  private cam: GlobeCamera
  private readonly listeners = new Set<(c: GlobeCamera) => void>()
  private frame: number | null = null
  private tour = false
  /** the follow under way, and what to tell when it ends */
  private chase: { end?: () => void } | null = null

  constructor(initial: GlobeCamera, private readonly onTouring?: (on: boolean) => void) { this.cam = initial }

  get camera(): GlobeCamera { return this.cam }
  get touring(): boolean { return this.tour }
  get following(): boolean { return this.chase != null }

  subscribe(fn: (c: GlobeCamera) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A move the user made (drag, wheel, keys, zoom buttons): any fly-to, tour or follow stops — except that a change of
   *  zoom alone keeps a follow going. */
  set(c: GlobeCamera): void {
    if (this.chase && c.lon === this.cam.lon && c.lat === this.cam.lat) { this.emit(c); return }
    this.stop()
    this.setTour(false)
    this.emit(c)
  }

  flyTo(target: GlobeCamera, then?: () => void): void {
    this.stop()
    if (then == null) this.setTour(false)
    if (reducedMotion() || typeof requestAnimationFrame === "undefined") { this.emit(target); then?.(); return }
    const from = this.cam
    let t0 = -1
    const step = (now: number) => {
      if (t0 < 0) t0 = now
      const k = Math.min(1, (now - t0) / FLY_MS)
      this.emit(cameraBetween(from, target, ease(k)))
      if (k < 1) this.frame = requestAnimationFrame(step)
      else { this.frame = null; then?.() }
    }
    this.frame = requestAnimationFrame(step)
  }

  /** The camera kept over a moving target (where it is at a frame's time; null ends the follow): eased onto it at
   *  `zoom`, the zoom then the user's. A move of the user's own, a fly-to, the tour or stopFollowing ends it, and `onEnd`
   *  is told. Under reduced motion it only goes there, and nothing is followed (`following` stays false). */
  follow(target: (nowMs: number) => { lon: number; lat: number } | null, zoom = this.cam.zoom, onEnd?: () => void): void {
    this.stop()
    this.setTour(false)
    if (reducedMotion() || typeof requestAnimationFrame === "undefined") {
      const at = target(performance.now())
      if (at) this.emit({ ...at, zoom })
      return
    }
    this.chase = { end: onEnd }
    let from = this.cam, goal = zoom, shown = from.zoom, start = -1, last = -Infinity
    const step = (now: number) => {
      this.frame = requestAnimationFrame(step)
      if (start < 0) start = now
      if (now - last < MOTION_FRAME_MS - FRAME_JITTER_MS) return
      last = now
      const at = target(now)
      if (!at) { this.stop(); return }
      // a zoom of the user's own (set() keeps the follow going) is kept from then on, even while easing on
      if (this.cam.zoom !== shown) { goal = this.cam.zoom; from = { ...from, zoom: goal } }
      const k = Math.min(1, (now - start) / FLY_MS)
      const c = k < 1 ? cameraBetween(from, { ...at, zoom: goal }, ease(k)) : { ...at, zoom: goal }
      shown = c.zoom
      this.emit(c)
    }
    this.frame = requestAnimationFrame(step)
  }

  /** Ends a follow under way (its `onEnd` is told). */
  stopFollowing(): void { if (this.chase) this.stop() }

  /** The world tour: out to the whole globe, then turning until a move or the button stops it. */
  setTouring(on: boolean): void {
    this.stop()
    this.setTour(on)
    if (!on) return
    this.flyTo({ ...TOUR_VIEW, lon: this.cam.lon }, () => {
      if (!this.tour || reducedMotion() || typeof requestAnimationFrame === "undefined") return
      let last = -1
      const spin = (now: number) => {
        this.frame = requestAnimationFrame(spin)
        if (last < 0) { last = now; return }
        if (now - last < MOTION_FRAME_MS - FRAME_JITTER_MS) return
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        this.emit({ ...this.cam, lon: wrapLon(this.cam.lon - TOUR_DEG_PER_S * dt) })
      }
      this.frame = requestAnimationFrame(spin)
    })
  }

  dispose(): void { this.stop(); this.listeners.clear() }

  private setTour(on: boolean): void {
    if (this.tour === on) return
    this.tour = on
    this.onTouring?.(on)
  }
  private stop(): void {
    if (this.frame != null) { cancelAnimationFrame(this.frame); this.frame = null }
    if (this.chase) { const end = this.chase.end; this.chase = null; end?.() }
  }
  private emit(c: GlobeCamera): void {
    this.cam = c
    for (const fn of this.listeners) fn(c)
  }
}
