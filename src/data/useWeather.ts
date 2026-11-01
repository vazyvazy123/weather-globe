import { useEffect, useState } from "react"
import type { CloudGrid } from "../globe/cloudField"
import { CITIES } from "./cities"
import { stored, store } from "./throttle"
import { CITY_EVERY_MS, GRID_EVERY_MS, RETRY_MS, fetchCities, fetchGrid, type CityWeather } from "./weather"

// The cities' weather and the cloud grid, each read when its stored copy is older than its interval, checked once a
// minute while the page is visible. A failure keeps what is held and waits RETRY_MS before the next try.

// v2: the longer city list (a v1 copy lacks most cities, so it is read again at once)
const CITY_KEY = "weather-globe:cities:v2"
const GRID_KEY = "weather-globe:grid:v1"
const TICK_MS = 60_000

export interface WeatherState {
  cities: CityWeather[] | null
  citiesAtMs: number | null
  grid: CloudGrid | null
  error: string | null
}

interface Source<T> { key: string; everyMs: number; read: () => Promise<T> }

interface Fresh<T> { value: T | null; atMs: number | null; error: string | null }

/** reads under way, by key: two components (or a remount) asking at once share one request */
const inFlight = new Map<string, Promise<unknown>>()

function readOnce<T>(src: Source<T>): Promise<T> {
  const running = inFlight.get(src.key) as Promise<T> | undefined
  if (running) return running
  const run = src.read().then((value) => { store(src.key, value, Date.now()); return value }).finally(() => inFlight.delete(src.key))
  inFlight.set(src.key, run)
  return run
}

/** A value kept fresh: the stored copy at once, a new read when it is due. */
function useFresh<T>(src: Source<T>): Fresh<T> {
  const [state, setState] = useState((): Fresh<T> => {
    const s = stored<T>(src.key)
    return { value: s ? s.value : null, atMs: s ? s.atMs : null, error: null }
  })
  useEffect(() => {
    let live = true, busy = false, triedAt = 0
    const tick = () => {
      if (busy || document.hidden) return
      const now = Date.now(), held = stored<T>(src.key)
      if (held && now - held.atMs < src.everyMs) return
      if (now - triedAt < RETRY_MS) return
      busy = true
      triedAt = now
      readOnce(src).then(
        (value) => { if (live) setState({ value, atMs: Date.now(), error: null }) },
        (err: unknown) => { if (live) setState((s) => ({ ...s, error: err instanceof Error ? err.message : "read failed" })) },
      ).finally(() => { busy = false })
    }
    tick()
    const id = window.setInterval(tick, TICK_MS)
    document.addEventListener("visibilitychange", tick)
    return () => { live = false; window.clearInterval(id); document.removeEventListener("visibilitychange", tick) }
  }, [src])
  return state
}

const CITY_SOURCE: Source<CityWeather[]> = { key: CITY_KEY, everyMs: CITY_EVERY_MS, read: () => fetchCities(CITIES) }
const GRID_SOURCE: Source<CloudGrid> = { key: GRID_KEY, everyMs: GRID_EVERY_MS, read: () => fetchGrid(Date.now()) }

export function useWeather(): WeatherState {
  const cities = useFresh(CITY_SOURCE)
  const grid = useFresh(GRID_SOURCE)
  return { cities: cities.value, citiesAtMs: cities.atMs, grid: grid.value, error: cities.error ?? grid.error }
}
