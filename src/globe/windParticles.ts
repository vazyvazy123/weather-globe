// The wind's particles: points drifting with the wind (windField.ts) over the part of the globe in view, each leaving a
// short trail of where it was, living a few seconds and born again somewhere in view — so the view stays evenly filled
// however close the camera is. They move the wind's way at a speed on screen proportional to its own
// (PX_PER_S_PER_MS: the same at every zoom). Their places are kept on the sphere, so turning the globe carries the
// trails along with it. The state is typed arrays changed in place each step: thousands of particles, thirty times a
// second.
import { sampleWind, type WindFrame } from "./windField"

/** the point under the camera (degrees) */
export interface WindCamera { readonly lon: number; readonly lat: number }
/** the screen and the globe's disk on it, CSS pixels (y down) */
export interface WindScreen { readonly w: number; readonly h: number; readonly cx: number; readonly cy: number; readonly r: number }

/** the places a trail keeps, the newest first */
export const TRAIL = 14
/** a trail segment as drawn: x0, y0, x1, y1 (device px, y down), opacity, the wind's speed (m/s) */
export const SEG_FLOATS = 6
/** CSS px a second a particle moves per m/s of wind */
export const PX_PER_S_PER_MS = 7
export const MAX_PARTICLES = 4000
/** CSS px² of globe in view per particle */
const AREA_PER_PARTICLE = 420
/** a particle lives this many steps (at 30 a second, ~1.7–3.7 s), fading in and out over FADE_STEPS */
const LIFE_MIN = 50
const LIFE_MAX = 110
const FADE_STEPS = 8
/** a particle this far off the screen (CSS px), past this latitude, or behind the horizon is born again in view */
const MARGIN_PX = 20
const POLE_LAT = 85
/** trails fade out toward the horizon, over this much of the sphere's depth */
const HORIZON_Z = 0.15
const SPAWN_TRIES = 16
/** the step that `settle` takes (s) */
const SETTLE_DT_S = 1 / 30
const RAD = Math.PI / 180

const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180

/** A camera's rotation, row-major: world (x toward 0° on the equator, y toward 90°E, z north) → camera (x right, y up,
 *  z toward the viewer). The same projection as the globe's shader. */
export function cameraMatrix(cam: WindCamera): Float64Array {
  const l = cam.lon * RAD, p = cam.lat * RAD, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p)
  return Float64Array.of(-sl, cl, 0, -sp * cl, -sp * sl, cp, cp * cl, cp * sl, sp)
}

export function toCamera(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
}

/** The place (lon, lat; degrees) at a point of the disk (its radius = 1, y up); null off the disk. */
export function unproject(cam: WindCamera, gx: number, gy: number): [number, number] | null {
  const d2 = gx * gx + gy * gy
  if (d2 >= 1) return null
  const gz = Math.sqrt(1 - d2), p0 = cam.lat * RAD, sp = Math.sin(p0), cp = Math.cos(p0)
  return [wrap(cam.lon + Math.atan2(gx, gz * cp - gy * sp) / RAD), Math.asin(Math.max(-1, Math.min(1, gy * cp + gz * sp))) / RAD]
}

export class WindParticles {
  readonly capacity = MAX_PARTICLES
  /** the particles alive: the first `count` */
  count = 0
  /** the trails' newest slot (every particle steps together) */
  private head = 0
  private readonly lon = new Float32Array(MAX_PARTICLES)
  private readonly lat = new Float32Array(MAX_PARTICLES)
  private readonly age = new Int32Array(MAX_PARTICLES)
  private readonly life = new Int32Array(MAX_PARTICLES)
  /** each particle's last TRAIL places on the sphere (x, y, z), and the wind's speed at each */
  private readonly trail = new Float32Array(MAX_PARTICLES * TRAIL * 3)
  private readonly speed = new Float32Array(MAX_PARTICLES * TRAIL)

  constructor(private readonly random: () => number = Math.random) {}

  /** particle `i`'s place (lon, lat; degrees) */
  at(i: number): [number, number] { return [this.lon[i], this.lat[i]] }

  /** Moves every particle `dtS` seconds on; those that die or leave the view are born again in it, and the count follows
   *  the globe's area in view. */
  step(f: WindFrame, cam: WindCamera, s: WindScreen, dtS: number): void {
    const target = Math.min(MAX_PARTICLES, Math.round(Math.min(Math.PI * s.r * s.r, s.w * s.h) / AREA_PER_PARTICLE))
    const m = cameraMatrix(cam), degPerMs = (PX_PER_S_PER_MS * Math.min(dtS, 0.1)) / s.r / RAD
    this.head = (this.head + 1) % TRAIL
    const old = Math.min(this.count, target)
    for (let i = 0; i < old; i++) {
      if (this.age[i] >= this.life[i]) { this.spawn(i, f, cam, s, m); continue }
      const [u, v] = sampleWind(f, this.lon[i], this.lat[i])
      const lat = this.lat[i] + v * degPerMs
      const lon = wrap(this.lon[i] + (u * degPerMs) / Math.max(Math.cos(this.lat[i] * RAD), 0.1))
      if (Math.abs(lat) > POLE_LAT || !this.place(i, lon, lat, Math.hypot(u, v), m, s, true)) { this.spawn(i, f, cam, s, m); continue }
      this.age[i]++
    }
    for (let i = old; i < target; i++) this.spawn(i, f, cam, s, m)
    this.count = target
  }

  /** Steps until every trail is whole: the wind drawn still (reduced motion: no frames follow). */
  settle(f: WindFrame, cam: WindCamera, s: WindScreen): void {
    for (let k = 0; k < TRAIL + FADE_STEPS; k++) this.step(f, cam, s, SETTLE_DT_S)
  }

  /** Writes the trails' segments as seen by the camera into `out` (SEG_FLOATS each, device pixels); returns how many. */
  segments(cam: WindCamera, s: WindScreen, dpr: number, out: Float32Array): number {
    const m = cameraMatrix(cam), t = this.trail
    let n = 0
    for (let i = 0; i < this.count; i++) {
      const pts = Math.min(this.age[i] + 1, TRAIL)
      const lifeA = Math.min(1, (this.age[i] + 1) / FADE_STEPS, (this.life[i] - this.age[i]) / FADE_STEPS)
      if (pts < 2 || lifeA <= 0) continue
      for (let k = 0; k + 1 < pts && (n + 1) * SEG_FLOATS <= out.length; k++) {
        const a = i * TRAIL + (this.head - k + TRAIL) % TRAIL, b = i * TRAIL + (this.head - k - 1 + TRAIL) % TRAIL
        const [ax, ay, az] = toCamera(m, t[a * 3], t[a * 3 + 1], t[a * 3 + 2])
        const [bx, by, bz] = toCamera(m, t[b * 3], t[b * 3 + 1], t[b * 3 + 2])
        const z = Math.min(az, bz) / HORIZON_Z
        if (z <= 0) continue
        const alpha = lifeA * (1 - k / (TRAIL - 1)) * (z >= 1 ? 1 : z * z * (3 - 2 * z))
        const o = n * SEG_FLOATS
        out[o] = (s.cx + s.r * ax) * dpr
        out[o + 1] = (s.cy - s.r * ay) * dpr
        out[o + 2] = (s.cx + s.r * bx) * dpr
        out[o + 3] = (s.cy - s.r * by) * dpr
        out[o + 4] = alpha
        out[o + 5] = this.speed[a]
        n++
      }
    }
    return n
  }

  /** Puts particle `i` at a place, as its trail's newest; with `checkView`, false (and nothing changed) where that is
   *  out of view. */
  private place(i: number, lon: number, lat: number, speed: number, m: Float64Array, s: WindScreen, checkView: boolean): boolean {
    const cl = Math.cos(lat * RAD), x = cl * Math.cos(lon * RAD), y = cl * Math.sin(lon * RAD), z = Math.sin(lat * RAD)
    if (checkView) {
      const [gx, gy, gz] = toCamera(m, x, y, z)
      const sx = s.cx + s.r * gx, sy = s.cy - s.r * gy
      if (gz <= 0 || sx < -MARGIN_PX || sx > s.w + MARGIN_PX || sy < -MARGIN_PX || sy > s.h + MARGIN_PX) return false
    }
    const at = i * TRAIL + this.head
    this.lon[i] = lon
    this.lat[i] = lat
    this.trail[at * 3] = x
    this.trail[at * 3 + 1] = y
    this.trail[at * 3 + 2] = z
    this.speed[at] = speed
    return true
  }

  /** Particle `i` born again somewhere in view, its trail starting afresh. */
  private spawn(i: number, f: WindFrame, cam: WindCamera, s: WindScreen, m: Float64Array): void {
    const [lon, lat] = this.spawnPoint(cam, s)
    const [u, v] = sampleWind(f, lon, lat)
    // a place drawn on the disk's part on the screen is in view already
    this.place(i, lon, lat, Math.hypot(u, v), m, s, false)
    this.age[i] = 0
    this.life[i] = LIFE_MIN + Math.floor(this.random() * (LIFE_MAX - LIFE_MIN))
  }

  /** A place in view, evenly drawn over the part of the disk on the screen. */
  private spawnPoint(cam: WindCamera, s: WindScreen): [number, number] {
    // draw on whichever is smaller, the disk or the screen, and keep what falls on the other
    const onDisk = Math.PI * s.r * s.r < s.w * s.h
    for (let k = 0; k < SPAWN_TRIES; k++) {
      let gx: number, gy: number
      if (onDisk) {
        const a = 2 * Math.PI * this.random(), d = Math.sqrt(this.random()) * 0.985
        gx = d * Math.cos(a)
        gy = d * Math.sin(a)
        const x = s.cx + s.r * gx, y = s.cy - s.r * gy
        if (x < 0 || x > s.w || y < 0 || y > s.h) continue
      } else {
        gx = (this.random() * s.w - s.cx) / s.r
        gy = (s.cy - this.random() * s.h) / s.r
        if (gx * gx + gy * gy > 0.97) continue
      }
      const ll = unproject(cam, gx, gy)
      if (ll) return ll
    }
    // the screen's middle, else the disk's
    return unproject(cam, (s.w / 2 - s.cx) / s.r, (s.cy - s.h / 2) / s.r) ?? [cam.lon, cam.lat]
  }
}
