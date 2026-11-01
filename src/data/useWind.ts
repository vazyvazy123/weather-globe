import { useEffect, useState } from "react"
import { meteoBudget } from "./meteoBudget"
import { stored, store } from "./throttle"
import { WIND_EVERY_MS, WIND_GRID, WIND_PARTS, fetchWindPart, mergeWind, windComplete, windPartRows, type WindGrid } from "./wind"

// The wind grid, read only while the wind is shown: the last whole read at once, a new one when that is older than
// WIND_EVERY_MS (checked once a minute while the page is visible). A read's parts are asked for one at a time, each when
// the minute's Open-Meteo calls leave it room (meteoBudget.ts), and show as they come — except over a whole read still
// usable, kept until the new one is whole. Each part is kept as it comes (apart from the last whole read), so a read cut
// short — a reload, the wind turned off — goes on from where it stopped; a part already being asked for is shared, never
// asked for twice. A failed part is tried again after PART_RETRY_MS, PART_TRIES times; then the read waits READ_RETRY_MS.

/** the last whole read */
const WIND_KEY = "weather-globe:wind:v1"
/** the read under way: its parts so far */
const PART_KEY = "weather-globe:wind-part:v1"
/** a read under way that has had no part for this long starts again */
const PART_FRESH_MS = 3600_000
const TICK_MS = 60_000
const PART_RETRY_MS = 60_000
const PART_TRIES = 3
const READ_RETRY_MS = 10 * 60_000

export interface WindState {
  grid: WindGrid | null
  /** the parts in so far while a read is under way; null when none is */
  reading: number | null
  error: string | null
}

/** when the last whole read came in (ms): a read is not repeated sooner than WIND_EVERY_MS even where it could not be
 *  stored */
let lastReadAt = -Infinity
/** the parts being asked for now, by part: whoever asks shares the one request */
const inFlight = new Map<number, Promise<WindGrid>>()

const sleep = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms))
/** the grid still reaches the present hour */
const usable = (g: WindGrid | null): boolean => g != null && (g.startS + g.hours * 3600) * 1000 > Date.now()
const partIn = (g: WindGrid, k: number): boolean => windPartRows(k).every((i) => g.rowsIn[i])
const partsIn = (g: WindGrid): number => Array.from({ length: WIND_PARTS }, (_, k) => k).filter((k) => partIn(g, k)).length

/** the read under way, while it is fresh */
function underWay(): WindGrid | null {
  const held = stored<WindGrid>(PART_KEY)
  return held && Date.now() - held.atMs < PART_FRESH_MS ? held.value : null
}

/** Part `k` of the read under way, put in with its parts so far and kept; asked for once the minute's calls leave room. */
function readPart(k: number): Promise<WindGrid> {
  const running = inFlight.get(k)
  if (running) return running
  const run = (async () => {
    const n = windPartRows(k).length * WIND_GRID.cols
    for (let ms = meteoBudget.waitFor(n); ms > 0; ms = meteoBudget.waitFor(n)) await sleep(ms)
    meteoBudget.spend(n)
    const next = mergeWind(underWay(), await fetchWindPart(k))
    if (windComplete(next)) {
      lastReadAt = Date.now()
      store(WIND_KEY, next, lastReadAt)
      try { globalThis.localStorage?.removeItem(PART_KEY) } catch { /* it ages out */ }
    } else {
      store(PART_KEY, next, Date.now())
    }
    return next
  })().finally(() => inFlight.delete(k))
  inFlight.set(k, run)
  return run
}

/** the grid to show from what is stored: the last whole read while usable, else the read under way, else nothing */
function storedGrid(): WindGrid | null {
  const whole = stored<WindGrid>(WIND_KEY)?.value ?? null
  return usable(whole) ? whole : underWay() ?? whole
}

export function useWind(on: boolean): WindState {
  const [state, setState] = useState((): WindState => ({ grid: storedGrid(), reading: null, error: null }))
  useEffect(() => {
    if (!on) return
    let live = true, busy = false, triedAt = -Infinity
    let wake: (() => void) | null = null
    const wait = (ms: number) => new Promise<void>((res) => { const id = window.setTimeout(res, ms); wake = () => { window.clearTimeout(id); res() } })
    const read = async () => {
      busy = true
      triedAt = Date.now()
      for (let k = 0, tries = 0; k < WIND_PARTS && live;) {
        const sofar = underWay()
        if (sofar && partIn(sofar, k)) { k++; continue }
        try {
          const next = await readPart(k)
          if (!live) break
          k++
          tries = 0
          const done = windComplete(next)
          setState((s) => {
            const keep = !done && s.grid != null && usable(s.grid) && windComplete(s.grid)
            return { grid: keep ? s.grid : next, reading: done ? null : partsIn(next), error: null }
          })
          if (done) break
        } catch (err) {
          if (!live) break
          setState((s) => ({ ...s, error: err instanceof Error ? err.message : "read failed" }))
          if (++tries >= PART_TRIES) { setState((s) => ({ ...s, reading: null })); break }
          await wait(PART_RETRY_MS)
        }
      }
      busy = false
    }
    const tick = () => {
      if (busy || document.hidden || Date.now() - triedAt < READ_RETRY_MS || Date.now() - lastReadAt < WIND_EVERY_MS) return
      const whole = stored<WindGrid>(WIND_KEY)
      if (whole && windComplete(whole.value) && Date.now() - whole.atMs < WIND_EVERY_MS) return
      void read()
    }
    tick()
    const id = window.setInterval(tick, TICK_MS)
    document.addEventListener("visibilitychange", tick)
    return () => {
      live = false
      wake?.()
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
      setState((s) => (s.reading == null ? s : { ...s, reading: null }))
    }
  }, [on])
  return state
}
