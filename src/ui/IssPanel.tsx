import { useEffect, useState } from "react"
import { CITIES } from "../data/cities"
import { countryName } from "../data/music"
import type { DayPick } from "../data/songOfDay"
import { whereBelow } from "../geo/below"
import { issAt, orbitMinutes, type Elements } from "../geo/orbit"
import { subsolarPoint, sunCosAt } from "../geo/sun"
import { WORLD_LAND } from "../geo/worldLand"
import { SongList } from "./MusicDock"
import type { Music } from "./useMusic"

// The ISS's panel: where it is now, live — what lies below it, its height and speed, day or night below; following it
// round the world; and the song of the day it picked: the first place with songs it flew over after midnight (UTC).

type Unit = "C" | "F"
const KM_PER_MI = 1.609344
const utcTime = (ms: number): string => new Date(ms).toISOString().slice(11, 16) + " UTC"

/** the time, a tick every `everyMs` */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

interface Props {
  el: Elements
  pick: DayPick | null
  unit: Unit
  music: Music
  following: boolean
  onFollow: () => void
  /** fly the globe to a city */
  onFly: (cityId: string) => void
  onClose: () => void
  boxRef: (el: HTMLElement | null) => void
}

export function IssPanel({ el, pick, unit, music, following, onFollow, onFly, onClose, boxRef }: Props) {
  const now = useNow(1000)
  const s = issAt(el, now)
  const below = whereBelow(s.lat, s.lon, CITIES, WORLD_LAND)
  const lit = sunCosAt(s.lat, s.lon, subsolarPoint(now)) > 0
  const mi = unit === "F", len = (km: number) => Math.round(mi ? km / KM_PER_MI : km).toLocaleString("en")
  const where = below.kind === "near" ? `Near ${below.city.name}, ${countryName(below.city.country)}` : below.kind === "land" ? "Over land" : `Over ${below.name}`
  return (
    <aside ref={boxRef} className="panel iss-panel" aria-label="The International Space Station">
      <button type="button" className="close" aria-label="Close" onClick={onClose}>×</button>
      <h2>International Space Station</h2>
      <p className="dim country">Live · once round the world every {Math.round(orbitMinutes(el))} minutes</p>
      <p className="iss-where">{where}{below.kind === "near" && <span className="dim"> · {len(below.km)} {mi ? "mi" : "km"}</span>}</p>
      <dl className="iss-stats">
        <div><dt>Height</dt><dd>{len(s.altKm)} {mi ? "mi" : "km"}</dd></div>
        <div><dt>Speed</dt><dd>{len(s.speedKmh)} {mi ? "mph" : "km/h"}</dd></div>
        <div><dt>Below</dt><dd>{lit ? "Day" : "Night"}</dd></div>
      </dl>
      <p className="dim">{s.lat.toFixed(2)}°, {s.lon.toFixed(2)}°</p>
      <button type="button" className={`chip iss-follow${following ? " on" : ""}`} aria-pressed={following} onClick={onFollow}>
        {following ? "Following the ISS" : "Follow the ISS"}
      </button>
      {pick && (
        <section className="day-song" aria-label="Song of the day">
          <h3><span aria-hidden="true">☀</span> Song of the day</h3>
          <p className="dim">
            Today the ISS {pick.atMs <= now ? "flew" : "flies"} over{" "}
            <button type="button" className="link" onClick={() => onFly(pick.city.id)}>{pick.city.name}</button>, {countryName(pick.city.country)} at{" "}
            {utcTime(pick.atMs)} — the day's song comes from there.
          </p>
          <SongList tracks={[pick.track]} music={music} country={countryName(pick.city.country)} title={null} />
        </section>
      )}
    </aside>
  )
}
