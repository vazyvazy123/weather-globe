// What lies below a point of the globe, in words: the nearest of the globe's cities where one is close; else the land or
// the sea it is over (Natural Earth's land, the sea named roughly by its region — enough to say "the Indian Ocean",
// not to draw coasts by). Pure.
import { greatCircleKm } from "./distance"
import { unwrapRing } from "../globe/landMask"
import type { City } from "../data/cities"

export type Below =
  | { readonly kind: "near"; readonly city: City; readonly km: number }
  | { readonly kind: "land" }
  | { readonly kind: "sea"; readonly name: string }

/** a city this close counts as what is below (km) */
const NEAR_KM = 600
/** south of this, land (Antarctica's ring circles the pole, so it is not tested as the others are) */
const ANTARCTIC_LAT = -63

interface Ring { readonly pts: number[]; readonly box: readonly [number, number, number, number] }
const ringCache = new WeakMap<ReadonlyArray<readonly number[]>, Ring[]>()

/** the land's rings with continuous longitudes and their boxes, the rings round a pole left out */
function ringsOf(land: ReadonlyArray<readonly number[]>): Ring[] {
  const held = ringCache.get(land)
  if (held) return held
  const out = land.flatMap((r): Ring[] => {
    const { pts, turns } = unwrapRing(r)
    if (turns !== 0 || pts.length < 6) return []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]) }
    return [{ pts, box: [x0, y0, x1, y1] }]
  })
  ringCache.set(land, out)
  return out
}

/** a point inside a ring (even-odd rule) */
function inRing(pts: readonly number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function onLand(lat: number, lon: number, land: ReadonlyArray<readonly number[]>): boolean {
  if (lat < ANTARCTIC_LAT) return true
  return ringsOf(land).some(({ pts, box }) => [lon, lon - 360, lon + 360].some((x) =>
    x >= box[0] && x <= box[2] && lat >= box[1] && lat <= box[3] && inRing(pts, x, lat)))
}

/** The sea at a point, by its region. */
export function seaName(lat: number, lon: number): string {
  if (lat <= -50) return "the Southern Ocean"
  if (lat >= 66) return "the Arctic Ocean"
  if (lat > 40.5 && lat < 47 && lon > 27 && lon < 42) return "the Black Sea"
  if (lat > 36 && lat < 48 && lon > 46 && lon < 55) return "the Caspian Sea"
  if (lat > 30 && lat < 46 && lon > -6 && lon < 37) return "the Mediterranean Sea"
  if (lat < 31 && ((lon >= 20 && lon < 120) || (lon >= 120 && lon < 147 && lat < -10))) return "the Indian Ocean"
  // the Atlantic's western shore, roughly: the Gulf of Mexico, the Caribbean, Panama, South America
  const west = lat > 18 ? -98 : lat > 8 ? -84 : lat > -10 ? -78 : -70
  return lon >= west && lon < 20 ? "the Atlantic Ocean" : "the Pacific Ocean"
}

export function whereBelow(lat: number, lon: number, cities: readonly City[], land: ReadonlyArray<readonly number[]>): Below {
  let best: City | null = null, km = Infinity
  for (const c of cities) {
    const d = greatCircleKm(lat, lon, c.lat, c.lon)
    if (d < km) { km = d; best = c }
  }
  if (best && km <= NEAR_KM) return { kind: "near", city: best, km }
  return onLand(lat, lon, land) ? { kind: "land" } : { kind: "sea", name: seaName(lat, lon) }
}
