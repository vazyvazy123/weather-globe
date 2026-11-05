// The song of the day, picked by the ISS: the first place with songs it flies over after midnight UTC — within OVER_KM of
// the point below it — and one of that place's own songs, the day's number turning through them. Anyone with the same
// elements is given the same song (elements renewed during the day move a pass by seconds, seldom to another place). On
// a day it went over none of them, the place nearest below it at noon. Pure.
import { greatCircleKm } from "../geo/distance"
import { firstPassNear, issAt, type Elements } from "../geo/orbit"
import type { City } from "./cities"
import type { Track } from "./music"

/** flying "over" a place: the point below the ISS this close to it (km) */
export const OVER_KM = 250
const DAY_MS = 86_400_000

export interface DayPick {
  readonly city: City
  /** when the ISS is closest over it */
  readonly atMs: number
  readonly track: Track
}

/** the UTC midnight that opens the day of a moment */
export const dayStartOf = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS

export function songOfDay(el: Elements, dayStartMs: number, cities: readonly City[], tracks: readonly Track[]): DayPick | null {
  const withSongs = cities.filter((c) => tracks.some((t) => t.city === c.id))
  if (!withSongs.length) return null
  const pass = firstPassNear(el, dayStartMs, dayStartMs + DAY_MS, withSongs, OVER_KM)
  const atMs = pass ? pass.atMs : dayStartMs + DAY_MS / 2
  const below = issAt(el, atMs)
  const city = pass
    ? withSongs.find((c) => c.id === pass.id) ?? withSongs[0]
    : withSongs.reduce((a, b) => (greatCircleKm(below.lat, below.lon, b.lat, b.lon) < greatCircleKm(below.lat, below.lon, a.lat, a.lon) ? b : a))
  const own = tracks.filter((t) => t.city === city.id)
  return { city, atMs, track: own[Math.floor(dayStartMs / DAY_MS) % own.length] }
}
