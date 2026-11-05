import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Globe, type GlobeCity } from "./Globe"
import { MusicDock, SongList, type Place } from "./MusicDock"
import { useMusic } from "./useMusic"
import { useBox } from "./useBox"
import { CITIES, type City } from "../data/cities"
import { countryName, MUSIC_CITIES, TRACKS, tracksForCity, WORLD_ORDER } from "../data/music"
import { useFresh, useWeather, type Source } from "../data/useWeather"
import { ISS_EVERY_MS, fetchIssTle, type IssTle } from "../data/iss"
import { dayStartOf, songOfDay } from "../data/songOfDay"
import type { PlaceHit } from "../data/places"
import { fetchPoint } from "../data/weather"
import { issAt, parseTle } from "../geo/orbit"
import { SearchBox } from "./SearchBox"
import { IssPanel } from "./IssPanel"
import { useWind, type WindState } from "../data/useWind"
import { WIND_PARTS } from "../data/wind"
import { satFieldOf, useSatellite, type SatState } from "../data/useSatellite"
import { TileFetcher } from "../data/tileFetcher"
import type { CityWeather } from "../data/weather"
import { GlobeCameraController, clampLat, wrapLon, zoomed, type GlobeCamera } from "../globe/camera"
import { REGIONS } from "../globe/regions"
import type { DetailStatus } from "../globe/detail"
import type { LabelBox } from "../globe/labels"
import { CLOUD_SOURCES } from "../geo/tiles"
import { skyLabel } from "../geo/sky"
import { cToF } from "../globe/tempColor"
import { windAt } from "../globe/windField"
import { WindLegend } from "./WindLegend"

// The page: the globe filling the window, the place search over its top left corner; a toolbar (regions, the world tour, the music,
// clouds, wind, the ISS, units, zoom); the panel of the city chosen (with its country's songs), of a place searched
// for, or of the ISS (with the song of the day it picked); the music player; and a caption saying what is drawn and
// where it comes from. With the music on, a city's click plays its song, and each new song flies the globe to its city.

type Unit = "C" | "F"
const START: GlobeCamera = { lon: -30, lat: 25, zoom: 1 }
const UNIT_KEY = "weather-globe:unit"
const WIND_KEY = "weather-globe:wind-on"
/** the wind shown is the forecast's for the present, taken afresh this often */
const WIND_FRAME_MS = 5 * 60_000
const CAPTION_PX = 64
/** a city clicked or played comes at least this close */
const CITY_ZOOM = 2.4
const MUSIC_ZOOM = 2
/** the room labels keep from the panels */
const PANEL_MARGIN_PX = 6
const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]))

const readUnit = (): Unit => { try { return globalThis.localStorage?.getItem(UNIT_KEY) === "F" ? "F" : "C" } catch { return "C" } }
const readWind = (): boolean => { try { return globalThis.localStorage?.getItem(WIND_KEY) === "1" } catch { return false } }
const ISS_KEY = "weather-globe:iss-on"
const readIss = (): boolean => { try { return globalThis.localStorage?.getItem(ISS_KEY) !== "0" } catch { return true } }
const ISS_SOURCE: Source<IssTle> = { key: "weather-globe:iss-tle:v1", everyMs: ISS_EVERY_MS, read: fetchIssTle }
/** a country found comes this close, a place found this close */
const COUNTRY_ZOOM = 1.8
const PLACE_ZOOM = 3.2
/** following the ISS the camera is kept over it, moved on every FOLLOW_MS; a move of the user's own (the camera more
 *  than FOLLOW_SLIP_DEG from where it was put) ends the following */
const FOLLOW_MS = 500
const FOLLOW_SLIP_DEG = 0.4
const FOLLOW_ZOOM = 1.6
/** the follow starts with a flight there (it takes ~650 ms); one not landed by now was cut short by the user */
const FOLLOW_START_MS = 900
/** elements further than this from their epoch do not place the ISS (the model holds for a day or so either side) */
const ISS_STALE_MS = 3 * 86_400_000
type FoundPlace = Extract<PlaceHit, { kind: "place" }>
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

function windCaption(w: WindState, shown: boolean, nowMs: number): string {
  if (!shown) {
    if (w.error && w.reading == null) return `Wind: forecast unavailable (${w.error})`
    return w.reading != null ? `Wind: reading the forecast (${w.reading} of ${WIND_PARTS})…` : "Wind: reading the forecast…"
  }
  const more = w.reading != null ? ` · filling in (${w.reading} of ${WIND_PARTS})` : ""
  return `Wind near the ground: Open-Meteo forecast for ${utcTime(nowMs)}${more}`
}

function detailCaption(d: DetailStatus | null): string | null {
  if (!d) return null
  const parts: string[] = []
  if (d.surface === "sharp") parts.push("land: Blue Marble detail tiles")
  else if (d.surface === "loading") parts.push("land: loading detail tiles…")
  else if (d.surface === "failed") parts.push("land: detail tiles unavailable")
  if (d.clouds) {
    const src = CLOUD_SOURCES[d.clouds.source]
    parts.push(d.clouds.have > 0
      ? d.clouds.visible ? `clouds as ${src.name} (${src.by}) saw them, ${utcTime(d.clouds.toMs)}` : `clouds sharpened by ${src.name} (${src.by}) ${utcTime(d.clouds.toMs)}`
      : `loading ${src.name} tiles…`)
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
  const [showWind, setShowWind] = useState(readWind)
  const [showIss, setShowIss] = useState(readIss)
  const [issOpen, setIssOpen] = useState(false)
  const [following, setFollowing] = useState(false)
  const [pin, setPin] = useState<FoundPlace | null>(null)
  const [pinWeather, setPinWeather] = useState<CityWeather | "failed" | null>(null)
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
  const [searchRef, searchBox] = useBox()

  const weather = useWeather()
  const sat = useSatellite(showClouds)
  const satellite = satFieldOf(sat)
  // the wind is read and drawn only on a GPU known to draw it (never for the plain outline globe)
  const windOn = showWind && gpu === true
  const wind = useWind(windOn)
  const windMoment = Math.floor(now / WIND_FRAME_MS) * WIND_FRAME_MS
  const windFrame = useMemo(() => (windOn && wind.grid ? windAt(wind.grid, windMoment / 1000) : null), [windOn, wind.grid, windMoment])
  // the ISS: its elements (read every few hours while it is shown), and the song of the day it picks
  const issTle = useFresh(ISS_SOURCE, showIss)
  const issEl = useMemo(() => (issTle.value ? parseTle(issTle.value.line1, issTle.value.line2) : null), [issTle.value])
  // elements kept from long ago (new ones could not be read) no longer place it: it is not shown as live from them
  const issLive = issEl && Math.abs(now - issEl.epochMs) < ISS_STALE_MS ? issEl : null
  const today = dayStartOf(now)
  const dayPick = useMemo(() => (issLive ? songOfDay(issLive, today, CITIES, TRACKS) : null), [issLive, today])
  const followRef = useRef(false)
  const follow = useCallback((on: boolean) => { followRef.current = on; setFollowing(on) }, [])

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
  const switchIss = () => {
    const next = !showIss
    try { globalThis.localStorage?.setItem(ISS_KEY, next ? "1" : "0") } catch { /* the choice lasts this visit only */ }
    setShowIss(next)
    if (!next) { setIssOpen(false); follow(false) }
  }
  const switchWind = () => setShowWind((on) => {
    try { globalThis.localStorage?.setItem(WIND_KEY, on ? "0" : "1") } catch { /* the choice lasts this visit only */ }
    return !on
  })
  const flyToCity = useCallback((id: string, zoom: number) => {
    const c = CITY_BY_ID.get(id)
    if (c) controller.flyTo({ lon: c.lon, lat: c.lat, zoom: Math.max(controller.camera.zoom, zoom) })
  }, [controller])

  const { playId, stop } = music
  const playingId = music.track?.id ?? null
  const onCity = useCallback((id: string) => {
    setSelected(id)
    setPin(null)
    setIssOpen(false)
    follow(false)
    flyToCity(id, CITY_ZOOM)
    // with the music on, a city plays its first song (unless one of its songs is on already)
    if (!musicMode) return
    const songs = tracksForCity(id, TRACKS, CITIES)
    if (songs.length && !songs.some((t) => t.id === playingId)) playId(songs[0].id)
  }, [flyToCity, musicMode, playingId, playId, follow])

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
  const findCity = useCallback((id: string) => { setSelected(id); setPin(null); setIssOpen(false); follow(false); flyToCity(id, CITY_ZOOM) }, [flyToCity, follow])

  // a place found by the search: a city opens as if clicked; a country or another place is flown to (a place with a pin
  // and its weather now)
  const onPick = useCallback((hit: PlaceHit) => {
    if (hit.kind === "city") { onCity(hit.id); return }
    setSelected(null)
    setIssOpen(false)
    follow(false)
    setPin(hit.kind === "place" ? hit : null)
    controller.flyTo({ lon: hit.lon, lat: clampLat(hit.lat), zoom: Math.max(controller.camera.zoom, hit.kind === "country" ? COUNTRY_ZOOM : PLACE_ZOOM) })
  }, [controller, onCity, follow])
  useEffect(() => {
    setPinWeather(null)
    if (!pin) return
    let live = true
    fetchPoint(pin.lat, pin.lon).then((w) => { if (live) setPinWeather(w) }, () => { if (live) setPinWeather("failed") })
    return () => { live = false }
  }, [pin])
  const pinMark = useMemo(() => (pin ? { lat: pin.lat, lon: pin.lon, name: pin.name } : null), [pin])

  const openIss = useCallback(() => { setIssOpen(true); setSelected(null); setPin(null) }, [])
  // following the ISS: a flight to it, then the camera kept over it — until the user moves the camera, or anything else
  // sends it somewhere (the ref stops a step already due before the effect is cleaned up)
  useEffect(() => {
    if (!following || !issLive) return
    let live = true, started = false, id = 0, put: GlobeCamera | null = null
    const step = () => {
      if (!live || !followRef.current) return
      // a hidden page is not followed (each move would draw the globe); it picks up where the ISS is when seen again
      if (document.hidden) { id = window.setTimeout(step, FOLLOW_MS); return }
      const cam = controller.camera
      if (put && (Math.abs(cam.lat - put.lat) > FOLLOW_SLIP_DEG || Math.abs(wrapLon(cam.lon - put.lon)) > FOLLOW_SLIP_DEG)) { follow(false); return }
      const s = issAt(issLive, Date.now())
      put = { lon: s.lon, lat: clampLat(s.lat), zoom: cam.zoom }
      controller.set(put)
      id = window.setTimeout(step, FOLLOW_MS)
    }
    const s = issAt(issLive, Date.now() + FOLLOW_START_MS)
    controller.flyTo({ lon: s.lon, lat: clampLat(s.lat), zoom: Math.max(controller.camera.zoom, FOLLOW_ZOOM) }, () => { started = true; step() })
    // a flight cut short (the user took the camera) never lands: then there is nothing to follow from
    const cut = window.setTimeout(() => { if (!started) follow(false) }, FOLLOW_START_MS)
    return () => { live = false; window.clearTimeout(id); window.clearTimeout(cut) }
  }, [following, issLive, controller, follow])

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
  const issPanel = issOpen && issLive != null
  const panelShown = issPanel || city != null || pin != null
  const avoid = useMemo(() => [...grow(showDock ? dockBox : null, PANEL_MARGIN_PX), ...grow(panelShown ? panelBox : null, PANEL_MARGIN_PX), ...grow(searchBox, PANEL_MARGIN_PX)],
    [showDock, dockBox, panelShown, panelBox, searchBox])

  return (
    <div className="app">
      <header className="bar">
        <h1>Weather Globe</h1>
        <nav className="tools" aria-label="Globe controls">
          {REGIONS.map(([name, cam]) => <button key={name} type="button" className="chip" onClick={() => { follow(false); controller.flyTo(cam) }}>{name}</button>)}
          <button type="button" className={`chip${touring ? " on" : ""}`} aria-pressed={touring} onClick={() => { follow(false); controller.setTouring(!touring) }}>Tour</button>
          <button ref={musicChip} type="button" className={`chip chip-music${musicMode ? " on" : ""}`} aria-pressed={musicMode} onClick={() => setMusicMode((v) => !v)}
            title="Songs from around the world">♪ Music</button>
          <button type="button" className={`chip${showClouds ? " on" : ""}`} aria-pressed={showClouds} onClick={() => setShowClouds((v) => !v)} disabled={gpu === false}>Clouds</button>
          <button type="button" className={`chip${showWind ? " on" : ""}`} aria-pressed={showWind} onClick={switchWind} disabled={gpu === false}
            title="The wind near the ground, from the weather forecast">Wind</button>
          <button type="button" className={`chip${showIss ? " on" : ""}`} aria-pressed={showIss} onClick={switchIss} title="The International Space Station, live">ISS</button>
          <button type="button" className="chip" onClick={switchUnit} aria-label={`Show temperatures in °${unit === "C" ? "F" : "C"}`}>°{unit}</button>
          <button type="button" className="chip" aria-label="Zoom in" onClick={() => controller.set(zoomed(controller.camera, 1.5))}>+</button>
          <button type="button" className="chip" aria-label="Zoom out" onClick={() => controller.set(zoomed(controller.camera, 1 / 1.5))}>−</button>
        </nav>
      </header>
      <main className={`stage${musicMode ? " music-mode" : ""}`}>
        <Globe cities={cities} clouds={weather.grid} satellite={showClouds ? satellite : null} selected={selected} onCity={onCity}
          controller={controller} showClouds={showClouds && gpu !== false} tiles={tiles} onGpu={setGpu} onDetail={setDetail} reserveBottom={CAPTION_PX}
          musicMode={musicMode} playing={trackCity} avoid={avoid} wind={windFrame} pin={pinMark} iss={showIss ? issLive : null} issSelected={issOpen} onIss={openIss} />
        <div ref={searchRef} className="stage-search"><SearchBox onPick={onPick} /></div>
        {issPanel ? (
          <IssPanel el={issLive} pick={dayPick} unit={unit} music={music} following={following} onFollow={() => follow(!following)}
            onFly={findCity} onClose={() => { setIssOpen(false); follow(false) }} boxRef={panelRef} />
        ) : city ? (
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
        ) : pin ? (
          <aside ref={panelRef} className="panel" aria-label={`${pin.name} weather`}>
            <button type="button" className="close" aria-label="Close" onClick={() => setPin(null)}>×</button>
            <h2>{pin.name}</h2>
            {pin.detail && <p className="dim country">{pin.detail}</p>}
            <p className="big">{pinWeather && pinWeather !== "failed" && pinWeather.tempC != null ? tempText(pinWeather.tempC, unit) : "—"}</p>
            <p>{pinWeather === "failed" ? "No reading just now" : pinWeather
              ? `${skyLabel(pinWeather.sky)}${pinWeather.cloudPct != null ? ` · ${Math.round(pinWeather.cloudPct)}% cloud cover` : ""}` : "Reading the weather…"}</p>
            {pinWeather && pinWeather !== "failed" && pinWeather.utcOffsetS != null && <p className="dim">Local time {localTime(now, pinWeather.utcOffsetS)}</p>}
            <p className="dim">{pin.lat.toFixed(2)}°, {pin.lon.toFixed(2)}°{pinWeather && pinWeather !== "failed" && pinWeather.atMs != null ? ` · read ${utcTime(pinWeather.atMs)}` : ""}</p>
          </aside>
        ) : null}
        {showDock && <MusicDock music={music} place={place} onClose={closeMusic} onFind={findCity} boxRef={dockRef} daySong={dayPick?.track ?? null} />}
        <footer className="caption">
          {gpu === false && <div>WebGL2 is unavailable: showing the plain outline globe.</div>}
          {gpu !== false && showClouds && <div>{satCaption(sat)}</div>}
          {windOn && <div className="wind-line">{windCaption(wind, windFrame != null, now)}{windFrame && <WindLegend unit={unit} />}</div>}
          {detailLine && <div>{detailLine}</div>}
          {weather.error && <div className="warn">Weather: {weather.error}</div>}
          {showIss && !issLive && (
            <div className={issTle.error ? "warn" : undefined}>
              {issTle.error ? `ISS: its orbit could not be read (${issTle.error})` : issEl ? "ISS: its orbit is out of date; reading it again…" : "ISS: reading its orbit…"}
            </div>
          )}
          <div className="credit">
            Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a> ·{" "}
            <a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA nowCOAST</a> · Weather data by{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0) · Land:{" "}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>
            {showIss && <> · ISS: <a href="https://wheretheiss.at/" target="_blank" rel="noopener noreferrer">wheretheiss.at</a></>}
            {showDock && <> · Music previews: <a href="https://www.apple.com/apple-music/" target="_blank" rel="noopener noreferrer">Apple Music</a>, photos: Deezer</>}
          </div>
        </footer>
      </main>
    </div>
  )
}
