import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Globe, type GlobeCity } from "./Globe"
import { MusicDock, SongList, type Place } from "./MusicDock"
import { useMusic } from "./useMusic"
import { useBox } from "./useBox"
import { CITIES, type City } from "../data/cities"
import { countryName, MUSIC_CITIES, TRACKS, tracksForCity, WORLD_ORDER } from "../data/music"
import { useWeather } from "../data/useWeather"
import { satFieldOf, useSatellite, type SatState } from "../data/useSatellite"
import { TileFetcher } from "../data/tileFetcher"
import type { CityWeather } from "../data/weather"
import { GlobeCameraController, zoomed, type GlobeCamera } from "../globe/camera"
import { REGIONS } from "../globe/regions"
import type { DetailStatus } from "../globe/detail"
import type { LabelBox } from "../globe/labels"
import { CLOUD_SOURCES } from "../geo/tiles"
import { skyLabel } from "../geo/sky"
import { cToF } from "../globe/tempColor"

// The page: the globe filling the window, a toolbar (regions, the world tour, the music, clouds, units, zoom), the
// selected city's panel (with its country's songs), the music player, and a caption saying what is drawn and where it
// comes from. With the music on, a city's click plays its song, and each new song flies the globe to its city.

type Unit = "C" | "F"
const START: GlobeCamera = { lon: -30, lat: 25, zoom: 1 }
const UNIT_KEY = "weather-globe:unit"
const CAPTION_PX = 64
/** a city clicked or played comes at least this close */
const CITY_ZOOM = 2.4
const MUSIC_ZOOM = 2
/** the room labels keep from the panels */
const PANEL_MARGIN_PX = 6
const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]))

const readUnit = (): Unit => { try { return globalThis.localStorage?.getItem(UNIT_KEY) === "F" ? "F" : "C" } catch { return "C" } }
const degrees = (c: number, unit: Unit): number => Math.round(unit === "F" ? cToF(c) : c)
const tempText = (c: number, unit: Unit): string => `${degrees(c, unit)}°${unit}`
const utcTime = (ms: number): string => new Date(ms).toISOString().slice(11, 16) + " UTC"
/** a city's local clock time from its UTC offset */
const localTime = (nowMs: number, offsetS: number): string => new Date(nowMs + offsetS * 1000).toISOString().slice(11, 16)

function cityNote(w: CityWeather | undefined): string {
  if (!w) return "No reading yet"
  const parts = [skyLabel(w.sky)]
  if (w.cloudPct != null) parts.push(`${Math.round(w.cloudPct)}% cloud`)
  if (w.atMs != null) parts.push(`read ${utcTime(w.atMs)}`)
  return parts.join(" · ")
}

function satCaption(s: SatState): string {
  switch (s.status) {
    case "none": return "Clouds: weather model (satellite image loading)"
    case "loading": return `Clouds: loading the ${utcTime(s.timeMs)} infrared mosaic…`
    case "ready": return `Clouds: NOAA GMGSI infrared mosaic, ${utcTime(s.sat.timeMs)}`
    case "failed": return s.sat ? `Clouds: NOAA GMGSI infrared, ${utcTime(s.sat.timeMs)} (newer image unavailable: ${s.why})` : `Clouds: weather model (satellite image unavailable: ${s.why})`
  }
}

function detailCaption(d: DetailStatus | null): string | null {
  if (!d) return null
  const parts: string[] = []
  if (d.surface === "sharp") parts.push("land: Blue Marble detail tiles")
  else if (d.surface === "loading") parts.push("land: loading detail tiles…")
  else if (d.surface === "failed") parts.push("land: detail tiles unavailable")
  if (d.clouds) {
    const src = CLOUD_SOURCES[d.clouds.source]
    parts.push(d.clouds.have > 0 ? `clouds sharpened by ${src.name} (${src.by}) ${utcTime(d.clouds.toMs)}` : `loading ${src.name} infrared tiles…`)
  }
  return parts.length ? parts.join(" · ") : null
}

const grow = (b: LabelBox | null, d: number): LabelBox[] => (b ? [[b[0] - d, b[1] - d, b[2] + d, b[3] + d]] : [])

export function App() {
  const [touring, setTouring] = useState(false)
  const controller = useMemo(() => new GlobeCameraController(START, setTouring), [])
  useEffect(() => () => controller.dispose(), [controller])
  const tiles = useMemo(() => new TileFetcher(), [])
  const [showClouds, setShowClouds] = useState(true)
  const [unit, setUnit] = useState<Unit>(readUnit)
  const [selected, setSelected] = useState<string | null>(null)
  const [gpu, setGpu] = useState<boolean | null>(null)
  const [detail, setDetail] = useState<DetailStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id) }, [])
  const [musicMode, setMusicMode] = useState(false)
  const music = useMusic(WORLD_ORDER)
  const [dockRef, dockBox] = useBox()
  const [panelRef, panelBox] = useBox()

  const weather = useWeather()
  const sat = useSatellite(showClouds)
  const satellite = satFieldOf(sat)

  const byId = useMemo(() => new Map((weather.cities ?? []).map((w) => [w.id, w])), [weather.cities])
  const cities: GlobeCity[] = useMemo(() => CITIES.map((c): GlobeCity => {
    const w = byId.get(c.id)
    const t = w?.tempC
    return { id: c.id, name: c.name, lat: c.lat, lon: c.lon, tier: c.tier, music: MUSIC_CITIES.has(c.id), sky: w?.sky ?? null, note: cityNote(w),
      temp: t != null ? { text: tempText(t, unit), short: `${degrees(t, unit)}°`, f: cToF(t) } : null }
  }), [byId, unit])

  const switchUnit = () => setUnit((u) => {
    const next = u === "C" ? "F" : "C"
    try { globalThis.localStorage?.setItem(UNIT_KEY, next) } catch { /* the choice lasts this visit only */ }
    return next
  })
  const flyToCity = useCallback((id: string, zoom: number) => {
    const c = CITY_BY_ID.get(id)
    if (c) controller.flyTo({ lon: c.lon, lat: c.lat, zoom: Math.max(controller.camera.zoom, zoom) })
  }, [controller])

  const { playId, stop } = music
  const playingId = music.track?.id ?? null
  const onCity = useCallback((id: string) => {
    setSelected(id)
    flyToCity(id, CITY_ZOOM)
    // with the music on, a city plays its first song (unless one of its songs is on already)
    if (!musicMode) return
    const songs = tracksForCity(id, TRACKS, CITIES)
    if (songs.length && !songs.some((t) => t.id === playingId)) playId(songs[0].id)
  }, [flyToCity, musicMode, playingId, playId])

  // each new song's city comes into view (the city just clicked is on its way already)
  const trackCity = music.track?.city ?? null
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    if (trackCity && trackCity !== selectedRef.current && !controller.touring) flyToCity(trackCity, MUSIC_ZOOM)
  }, [trackCity, controller, flyToCity])

  // closing the player hands the keyboard focus back to the chip that opens it
  const musicChip = useRef<HTMLButtonElement>(null)
  const closeMusic = useCallback(() => { musicChip.current?.focus(); stop(); setMusicMode(false) }, [stop])
  const findCity = useCallback((id: string) => { setSelected(id); flyToCity(id, CITY_ZOOM) }, [flyToCity])

  const city: City | undefined = selected ? CITY_BY_ID.get(selected) : undefined
  const cw = city ? byId.get(city.id) : undefined
  const citySongs = useMemo(() => (city ? tracksForCity(city.id, TRACKS, CITIES) : []), [city])
  const detailLine = detailCaption(detail)

  const place: Place | null = useMemo(() => {
    const c = trackCity ? CITY_BY_ID.get(trackCity) : undefined
    if (!c) return null
    const w = byId.get(c.id)
    return { id: c.id, name: c.name, country: countryName(c.country), temp: w?.tempC != null ? tempText(w.tempC, unit) : null,
      time: w?.utcOffsetS != null ? localTime(now, w.utcOffsetS) : null }
  }, [trackCity, byId, unit, now])
  const showDock = musicMode || music.track != null
  const avoid = useMemo(() => [...grow(showDock ? dockBox : null, PANEL_MARGIN_PX), ...grow(city ? panelBox : null, PANEL_MARGIN_PX)], [showDock, dockBox, city, panelBox])

  return (
    <div className="app">
      <header className="bar">
        <h1>Weather Globe</h1>
        <nav className="tools" aria-label="Globe controls">
          {REGIONS.map(([name, cam]) => <button key={name} type="button" className="chip" onClick={() => controller.flyTo(cam)}>{name}</button>)}
          <button type="button" className={`chip${touring ? " on" : ""}`} aria-pressed={touring} onClick={() => controller.setTouring(!touring)}>Tour</button>
          <button ref={musicChip} type="button" className={`chip chip-music${musicMode ? " on" : ""}`} aria-pressed={musicMode} onClick={() => setMusicMode((v) => !v)}
            title="Songs from around the world">♪ Music</button>
          <button type="button" className={`chip${showClouds ? " on" : ""}`} aria-pressed={showClouds} onClick={() => setShowClouds((v) => !v)} disabled={gpu === false}>Clouds</button>
          <button type="button" className="chip" onClick={switchUnit} aria-label={`Show temperatures in °${unit === "C" ? "F" : "C"}`}>°{unit}</button>
          <button type="button" className="chip" aria-label="Zoom in" onClick={() => controller.set(zoomed(controller.camera, 1.5))}>+</button>
          <button type="button" className="chip" aria-label="Zoom out" onClick={() => controller.set(zoomed(controller.camera, 1 / 1.5))}>−</button>
        </nav>
      </header>
      <main className={`stage${musicMode ? " music-mode" : ""}`}>
        <Globe cities={cities} clouds={weather.grid} satellite={showClouds ? satellite : null} selected={selected} onCity={onCity}
          controller={controller} showClouds={showClouds && gpu !== false} tiles={tiles} onGpu={setGpu} onDetail={setDetail} reserveBottom={CAPTION_PX}
          musicMode={musicMode} playing={trackCity} avoid={avoid} />
        {city && (
          <aside ref={panelRef} className="panel" aria-label={`${city.name} weather`}>
            <button type="button" className="close" aria-label="Close" onClick={() => setSelected(null)}>×</button>
            <h2>{city.name}</h2>
            <p className="dim country">{countryName(city.country)}</p>
            <p className="big">{cw?.tempC != null ? tempText(cw.tempC, unit) : "—"}</p>
            <p>{skyLabel(cw?.sky)}{cw?.cloudPct != null ? ` · ${Math.round(cw.cloudPct)}% cloud cover` : ""}</p>
            {cw?.utcOffsetS != null && <p className="dim">Local time {localTime(now, cw.utcOffsetS)}</p>}
            <p className="dim">{city.lat.toFixed(2)}°, {city.lon.toFixed(2)}°{cw?.atMs != null ? ` · read ${utcTime(cw.atMs)}` : ""}</p>
            <SongList tracks={citySongs} music={music} country={countryName(city.country)} />
          </aside>
        )}
        {showDock && <MusicDock music={music} place={place} onClose={closeMusic} onFind={findCity} boxRef={dockRef} />}
        <footer className="caption">
          {gpu === false && <div>WebGL2 is unavailable: showing the plain outline globe.</div>}
          {gpu !== false && showClouds && <div>{satCaption(sat)}</div>}
          {detailLine && <div>{detailLine}</div>}
          {weather.error && <div className="warn">Weather: {weather.error}</div>}
          <div className="credit">
            Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a> ·{" "}
            <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA nowCOAST</a> · Weather data by{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0) · Land:{" "}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>
            {showDock && <> · Music previews: <a href="https://www.apple.com/apple-music/" target="_blank" rel="noopener noreferrer">Apple Music</a>, photos: Deezer</>}
          </div>
        </footer>
      </main>
    </div>
  )
}
