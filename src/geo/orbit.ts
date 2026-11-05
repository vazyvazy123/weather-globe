// Where the ISS is, from its orbital elements (a NORAD two-line element set, TLE): the orbit an ellipse whose plane and
// perigee turn under the Earth's flattening (J2's secular rates, its mean motion recovered from the TLE's as SGP4 does)
// and whose mean anomaly quickens with drag; then the Earth turned under it (Greenwich sidereal time, IAU 1982, as the
// elements' TEME frame wants) for the point below on the WGS-84 ellipsoid. Within a fraction of a degree for a day or
// so either side of the elements' epoch — plenty for a marker on a globe. Pure.
import { greatCircleKm } from "./distance"

export interface Elements {
  /** the elements' epoch (ms) */
  readonly epochMs: number
  /** inclination, right ascension of the ascending node, argument of perigee, mean anomaly (rad) */
  readonly incl: number
  readonly raan: number
  readonly argp: number
  readonly mo: number
  readonly ecc: number
  /** mean motion (rad/min), and half its rate of change (rad/min²) */
  readonly no: number
  readonly ndot2: number
}

export interface SubPoint {
  readonly lat: number
  readonly lon: number
  readonly altKm: number
  readonly speedKmh: number
}

const RAD = Math.PI / 180
const TWO_PI = 2 * Math.PI
const MIN_PER_DAY = 1440
const MU = 398600.4418 // km³/s²
const RE = 6378.137 // km, WGS-84
const J2 = 1.08262668e-3
const CK2 = J2 / 2
const FLAT = 1 / 298.257223563
const E2 = FLAT * (2 - FLAT)
/** √μ in Earth radii^1.5 per minute */
const KE = 60 / Math.sqrt((RE * RE * RE) / MU)

const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180

/** A TLE's two lines as elements; null where they are not one. */
export function parseTle(line1: string, line2: string): Elements | null {
  const l1 = line1.trimEnd(), l2 = line2.trimEnd()
  if (l1.length < 63 || l2.length < 63 || l1[0] !== "1" || l2[0] !== "2") return null
  const n = (s: string) => (s.trim() ? Number(s.trim()) : NaN)
  const yy = n(l1.slice(18, 20)), day = n(l1.slice(20, 32)), ndot2 = n(l1.slice(33, 43))
  const incl = n(l2.slice(8, 16)), raan = n(l2.slice(17, 25)), ecc = n(`0.${l2.slice(26, 33).trim()}`)
  const argp = n(l2.slice(34, 42)), mo = n(l2.slice(43, 51)), revs = n(l2.slice(52, 63))
  if (![yy, day, ndot2, incl, raan, ecc, argp, mo, revs].every(Number.isFinite) || revs <= 0 || ecc >= 1) return null
  return {
    epochMs: Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (day - 1) * 86_400_000,
    incl: incl * RAD, raan: raan * RAD, argp: argp * RAD, mo: mo * RAD, ecc,
    no: (revs * TWO_PI) / MIN_PER_DAY,
    ndot2: (ndot2 * TWO_PI) / (MIN_PER_DAY * MIN_PER_DAY),
  }
}

/** one turn round the Earth (minutes) */
export const orbitMinutes = (el: Elements): number => TWO_PI / el.no

/** Greenwich mean sidereal time (rad) at a moment (ms), IAU 1982. */
export function gmst(tMs: number): number {
  const t = (tMs / 86_400_000 + 2440587.5 - 2451545) / 36525
  const s = -6.2e-6 * t * t * t + 0.093104 * t * t + (876600 * 3600 + 8640184.812866) * t + 67310.54841
  const g = ((s * RAD) / 240) % TWO_PI
  return g < 0 ? g + TWO_PI : g
}

/** The point below the ISS at a moment (ms), its height and its speed. */
export function issAt(el: Elements, tMs: number): SubPoint {
  const t = (tMs - el.epochMs) / 60_000
  const cosi = Math.cos(el.incl), sini = Math.sin(el.incl), th2 = cosi * cosi
  const beta0 = Math.sqrt(1 - el.ecc * el.ecc)
  // the mean motion and the axis without the part of J2 the TLE's mean motion holds (SGP4's recovery)
  const a1 = Math.pow(KE / el.no, 2 / 3)
  const d1 = (1.5 * CK2 * (3 * th2 - 1)) / (beta0 * beta0 * beta0 * a1 * a1)
  const a0 = a1 * (1 - d1 / 3 - d1 * d1 - (134 / 81) * d1 * d1 * d1)
  const d0 = (1.5 * CK2 * (3 * th2 - 1)) / (beta0 * beta0 * beta0 * a0 * a0)
  const n = el.no / (1 + d0), a = a0 / (1 - d0)
  // J2 turns the node and the perigee and hastens the mean anomaly (SGP4's 3·k2·n/p², the node ~5° a day for the
  // ISS); drag quickens it
  const p = a * beta0 * beta0, k = (3 * CK2 * n) / (p * p)
  const m = el.mo + (n + 0.5 * k * beta0 * (3 * th2 - 1)) * t + el.ndot2 * t * t
  const argp = el.argp - 0.5 * k * (1 - 5 * th2) * t, raan = el.raan - k * cosi * t
  let ea = m
  for (let i = 0; i < 6; i++) ea -= (ea - el.ecc * Math.sin(ea) - m) / (1 - el.ecc * Math.cos(ea))
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.ecc) * Math.sin(ea / 2), Math.sqrt(1 - el.ecc) * Math.cos(ea / 2))
  const r = a * (1 - el.ecc * Math.cos(ea)) * RE, u = argp + nu
  const cu = Math.cos(u), su = Math.sin(u), co = Math.cos(raan), so = Math.sin(raan)
  const x = r * (co * cu - so * su * cosi), y = r * (so * cu + co * su * cosi), z = r * su * sini
  // the latitude and height over the ellipsoid (Bowring's iteration)
  const rho = Math.hypot(x, y)
  let lat = Math.atan2(z, rho), h = 0
  for (let i = 0; i < 4; i++) {
    const s = Math.sin(lat), nr = RE / Math.sqrt(1 - E2 * s * s)
    h = rho / Math.cos(lat) - nr
    lat = Math.atan2(z, rho * (1 - (E2 * nr) / (nr + h)))
  }
  return {
    lat: lat / RAD,
    lon: wrap((Math.atan2(y, x) - gmst(tMs)) / RAD),
    altKm: h,
    speedKmh: Math.sqrt(MU * (2 / r - 1 / (a * RE))) * 3600,
  }
}

/** The points below the ISS from one moment to another (ms), `stepMs` apart. */
export function groundTrack(el: Elements, fromMs: number, toMs: number, stepMs: number): Array<{ lat: number; lon: number; tMs: number }> {
  const out: Array<{ lat: number; lon: number; tMs: number }> = []
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const s = issAt(el, t)
    out.push({ lat: s.lat, lon: s.lon, tMs: t })
  }
  return out
}

/** The first place the ISS goes over between two moments — within `withinKm` of the point below it — and when it is
 *  closest on that pass; null where it goes over none of them. */
export function firstPassNear(el: Elements, fromMs: number, toMs: number, places: ReadonlyArray<{ id: string; lat: number; lon: number }>, withinKm: number,
  stepMs = 15_000): { id: string; atMs: number; km: number } | null {
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const s = issAt(el, t)
    for (const p of places) {
      if (Math.abs(p.lat - s.lat) * 111 > withinKm) continue
      const km = greatCircleKm(s.lat, s.lon, p.lat, p.lon)
      if (km > withinKm) continue
      // ride the pass to its closest moment, a second at a time near the end
      let best = { t, km }
      for (let u = t + 1000; u <= t + 2 * stepMs; u += 1000) {
        const q = issAt(el, u), d = greatCircleKm(q.lat, q.lon, p.lat, p.lon)
        if (d < best.km) best = { t: u, km: d }
      }
      return { id: p.id, atMs: best.t, km: best.km }
    }
  }
  return null
}
