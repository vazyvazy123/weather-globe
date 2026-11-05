import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { globeLandPath, graticulePath } from "../geo/orthographic"
import { subsolarPoint, sunCosAt } from "../geo/sun"
import type { Sky } from "../geo/sky"
import { WORLD_LAND } from "../geo/worldLand"
import { GlobeGl } from "../globe/globeGl"
import { cloudField, type CloudGrid } from "../globe/cloudField"
import { chipWidth, pillBox, pillWidth, placeLabels, type LabelBox, type LabelSide } from "../globe/labels"
import { spreadMarkers } from "../globe/declutter"
import { tempColor } from "../globe/tempColor"
import { clampLat, reducedMotion, wrapLon, zoomed, type GlobeCamera, type GlobeCameraController } from "../globe/camera"
import { pinchFactor, pinched, spread, type Point } from "../globe/gesture"
import type { SatField } from "../globe/satClouds"
import { DetailLoader, type DetailStatus } from "../globe/detail"
import type { TileFetcher } from "../data/tileFetcher"
import { TIER_ZOOM, type CityTier } from "../data/cities"
import { PACE_START, paceFrame } from "./framePace"
import { WindView } from "../globe/windView"
import type { WindFrame } from "../globe/windField"
import { groundTrack, issAt, issFrame, type Elements } from "../geo/orbit"
import { IssGl, ISS_CANVAS_PX } from "../globe/issGl"
import { EARTH_KM, smallCircle } from "../geo/distance"

// The globe, in three layers on one orthographic projection (screen pixels):
//  - the GPU (globeGl.ts): the surface as NASA's Blue Marble shows it, the sun's real day and night, the clouds where a
//    satellite saw them (the weather model's beyond its image), the atmosphere — and, once the view stands still zoomed
//    in, the sharp detail of the part in view (detail.ts: the surface's tiles, the clouds sharpened by the infrared of
//    the satellite overhead);
//  - the wind (windView.ts): particles drifting with the wind near the ground, on a canvas of their own over the GPU's,
//    so their motion never redraws the globe;
//  - SVG: the ISS, live (orbit.ts), drawn at its height above the ground — so it stands off the surface and rises over
//    the globe's edge — with its path behind and ahead, a line down to the point below it, the ground its crew can see,
//    and dimmed in the Earth's shadow; moved on by a timer of its own (as often as it moves a pixel) without the globe
//    being drawn again; and the pin on a place searched for;
//  - SVG: each city's marker, a ring lying ON the surface (it tilts and narrows with the globe), with a silver glow where
//    it is night;
//  - label pills (HTML): name and temperature on one cold → hot scale. The labels keep clear of the markers, of each
//    other and of the panels over the globe, and hold their places as the globe moves (labels.ts).
// Where many cities crowd, only some show: a city's tier sets the zoom it appears at, and markers keep apart
// (declutter.ts) — the most important first: the selected city, the one playing, the music cities while the music is
// on, then by tier, then the ones already shown (so nothing flickers as the globe turns). A city whose full pill has no
// room shows its temperature alone, in a small chip, where that fits.
// The camera lives outside React (camera.ts): a drag, the wheel, a fly-to or the tour moves it and layout() writes the
// new positions straight into the elements (looked up once per render, not per frame), so the globe turns at the
// display's frame rate without re-rendering. Frames are drawn only when something moves: the camera, new clouds being
// baked, a sharp picture fading in, lightning in a storm.

export interface GlobeCity {
  id: string
  name: string
  lon: number
  lat: number
  /** the temperature as the pill shows it, as the compact chip shows it, and in °F for its colour */
  temp: { text: string; short: string; f: number } | null
  /** the sky now, for the clouds over the city */
  sky: Sky | null
  /** the tooltip: the conditions and when they were read */
  note: string
  tier: CityTier
  /** a song stands on this city (music.ts) */
  music: boolean
}

/** the globe's radius at zoom 1, as a share of the frame's smaller side (room left for the atmosphere) */
const FIT = 0.46
const DRAG_START_PX = 4
/** a finger drifts more than a mouse in a tap */
const TOUCH_DRAG_START_PX = 10
/** the ring's radius on the ground, as it shows face-on (px) */
const MARKER_PX = 4.2
/** markers closer than this crowd each other: the less important one is not shown */
const MARKER_GAP_PX = 16
/** the room a pill gives its music note */
const NOTE_PX = 14
const RING_POINTS = 24
const RING_TRIG = Array.from({ length: RING_POINTS }, (_, k) => [Math.cos((2 * Math.PI * k) / RING_POINTS), Math.sin((2 * Math.PI * k) / RING_POINTS)])
/** lightning flickers this often while a storm shows */
const STORM_MS = 250
/** lightning is drawn (and the globe redrawn for it) only this close: farther out a flash is too small to see, and the
 *  globe rests between moves */
const LIGHTNING_ZOOM = 2.5
/** where the GPU cannot keep up while the globe moves, it draws at DPR_STEP fewer device pixels per CSS pixel (never under
 *  one), and a step more again once it can (see framePace) */
const DPR_STEP = 0.25
/** the camera counts as moving while it moved this recently */
const MOVING_MS = 100
/** the ISS's path drawn behind it and ahead of it (minutes), a point every ISS_TRACK_STEP_MS, worked out afresh every
 *  ISS_TRACK_EVERY_MS */
const ISS_PAST_MIN = 10
const ISS_NEXT_MIN = 45
const ISS_TRACK_STEP_MS = 40_000
const ISS_TRACK_EVERY_MS = 60_000
/** the ISS crosses the globe this fast (rad/s: once round in ~93 minutes); it is moved on when it has gone ISS_STEP_PX on
 *  screen, at most every ISS_MIN_MS, at least every ISS_MAX_MS */
const ISS_RAD_PER_S = (2 * Math.PI) / (93 * 60)
const ISS_STEP_PX = 0.75
const ISS_MIN_MS = 100
const ISS_MAX_MS = 1000
/** the steps round the ground the ISS's crew can see */
const ISS_FOOT_STEPS = 72
/** the station grows a little as the camera closes in: this much a step of zoom, up to ISS_SCALE_MAX */
const ISS_SCALE_PER_ZOOM = 0.12
const ISS_SCALE_MAX = 1.6
/** the 3D station's size at the whole-globe view, CSS px a metre (its 107 m truss ~64 px) */
const ISS_PX_PER_M = 0.6
/** the station's solar arrays: four wings each side of the truss, each a pair up and down it (its drawing's units) */
const ISS_ARRAY_X = [-21, -14.6, 9, 15.4]
const ISS_ARRAYS = ISS_ARRAY_X.map((x) => `M${x} -11h5.6v9.4h-5.6zM${x} 1.6h5.6v9.4h-5.6z`).join("")
const ISS_CELLS = ISS_ARRAY_X.map((x) => `M${x + 2.8} -11v9.4M${x + 2.8} 1.6v9.4M${x} -6.3h5.6M${x} 6.3h5.6`).join("")
/** device pixels per CSS pixel, at most: past 2 the eye gains little and the shader pays for every pixel */
const DPR_MAX = 2
/** the sun is redrawn this often (it moves a quarter of a degree a minute) */
const SUN_EVERY_MS = 60_000
/** below this sun height (cosine of the zenith angle) a city counts as in the night */
const NIGHT_COS = -0.05
const RAD = Math.PI / 180

interface Props {
  cities: GlobeCity[]
  clouds: CloudGrid | null
  /** the satellite's cloud field (useSatellite.ts); null = the model's clouds everywhere */
  satellite: SatField | null
  selected: string | null
  onCity: (id: string) => void
  controller: GlobeCameraController
  showClouds: boolean
  tiles: TileFetcher
  /** whether the GPU layer (and with it the clouds) is drawn; false = the plain SVG globe */
  onGpu?: (ok: boolean) => void
  /** what the sharp pictures are now, for the caption */
  onDetail?: (s: DetailStatus) => void
  /** screen space reserved at the bottom (the caption), in CSS pixels */
  reserveBottom?: number
  /** the music is on: the cities with songs show first, marked with a note */
  musicMode?: boolean
  /** the city whose song is playing: always shown, with sound rings */
  playing?: string | null
  /** boxes the labels keep clear of (the panels over the globe), in CSS pixels */
  avoid?: readonly LabelBox[]
  /** the wind to draw over the globe (windField.ts); null = none */
  wind?: WindFrame | null
  /** a place searched for, marked with a pin; null = none */
  pin?: { lat: number; lon: number; name: string } | null
  /** the ISS's elements (orbit.ts): the station and its path, live; null = not shown */
  iss?: Elements | null
  /** the ISS's panel is open: the station is marked as chosen */
  issSelected?: boolean
  onIss?: () => void
  /** the ISS's clock (ms): the real one unless a time-lapse ride runs it faster */
  issClock?: () => number
}

type Vec3 = [number, number, number]
/** a world vector (x toward 0° lon, y toward 90°E, z north) in the camera's frame (x right, y up, z toward the viewer) */
function toCam(v: Vec3, view: GlobeCamera): Vec3 {
  const l0 = view.lon * RAD, p0 = view.lat * RAD
  const a = v[0] * Math.cos(l0) + v[1] * Math.sin(l0), b = -v[0] * Math.sin(l0) + v[1] * Math.cos(l0)
  return [b, Math.cos(p0) * v[2] - Math.sin(p0) * a, Math.sin(p0) * v[2] + Math.cos(p0) * a]
}
const unit = (lat: number, lon: number): Vec3 => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]

/** the elements layout() moves, found once per render */
interface CityEls {
  g: SVGGElement; lat: number; lon: number; tier: CityTier; music: boolean
  rings: Array<[SVGPolygonElement, number]>; pill: HTMLElement | null
  /** whether the pill shows as the compact chip now; null = not yet set since the last render */
  compact: boolean | null
}
const NO_BOXES: readonly LabelBox[] = []
const abs = (b: LabelBox, x: number, y: number): LabelBox => [x + b[0], y + b[1], x + b[2], y + b[3]]
// (a city already hidden is left alone: most of them are, at every frame of a turn)
const hideCity = (c: CityEls) => {
  if (c.g.style.display !== "none") c.g.style.display = "none"
  if (c.pill && c.pill.style.display !== "none") c.pill.style.display = "none"
}

export const Globe = memo(function Globe({ cities, clouds, satellite, selected, onCity, controller, showClouds, tiles, onGpu, onDetail, reserveBottom = 0,
  musicMode = false, playing = null, avoid = NO_BOXES, wind = null, pin = null, iss = null, issSelected = false, onIss, issClock }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
  /** the sound rings round the city playing: HTML, so the compositor animates them without repainting the markers */
  const wavesRef = useRef<HTMLDivElement>(null)
  /** the wind's own canvas over the globe's, and what draws on it (made the first time there is wind) */
  const windRef = useRef<HTMLCanvasElement>(null)
  const windView = useRef<WindView | null>(null)
  /** the pin on a place searched for; the ISS, its craft (turned across its path) and its path behind and ahead */
  const pinRef = useRef<SVGGElement>(null)
  const issRef = useRef<SVGGElement>(null)
  const issCraftRef = useRef<SVGGElement>(null)
  const issPastRef = useRef<SVGPathElement>(null)
  const issNextRef = useRef<SVGPathElement>(null)
  const issFootRef = useRef<SVGPathElement>(null)
  const issPlumbRef = useRef<SVGPathElement>(null)
  const issGroundRef = useRef<SVGCircleElement>(null)
  /** rings round the ISS while its panel is open (HTML: the compositor scales them) */
  const issBeaconRef = useRef<HTMLDivElement>(null)
  /** the station in 3D (issGl.ts), on a small canvas of its own; null where WebGL2 is not to be had (the drawn one stays) */
  const issCanvasRef = useRef<HTMLCanvasElement>(null)
  const issGl = useRef<IssGl | null>(null)
  const issTrack = useRef<{ el: Elements; at: number; pts: Array<{ lat: number; lon: number; tMs: number }> } | null>(null)
  const [dprCap, setDprCap] = useState(DPR_MAX)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [gl, setGl] = useState<GlobeGl | "none" | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => { const b = el.getBoundingClientRect(); setSize((s) => (Math.round(b.width) === s.w && Math.round(b.height) === s.h ? s : { w: Math.round(b.width), h: Math.round(b.height) })) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener("resize", measure)
    return () => { ro.disconnect(); window.removeEventListener("resize", measure) }
  }, [])
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), SUN_EVERY_MS); return () => window.clearInterval(id) }, [])
  const sun = useMemo(() => subsolarPoint(now), [now])

  useEffect(() => { if (gl != null) onGpu?.(gl !== "none") }, [gl, onGpu])
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    let live = true, restores = 0
    let current: GlobeGl | null = null
    // made while the page shows (the GPU builds its programs, the coastline arrives); one made after this is gone is let go
    const make = () => GlobeGl.create(c).then((next) => {
      if (!live) { next?.dispose(); return }
      current = next
      setGl(next ?? "none")
    })
    void make()
    const lost = (e: Event) => { e.preventDefault(); setGl("none") }
    const restored = () => {
      if (!live || restores >= 2) return
      restores++
      void make()
    }
    c.addEventListener("webglcontextlost", lost)
    c.addEventListener("webglcontextrestored", restored)
    return () => {
      live = false
      c.removeEventListener("webglcontextlost", lost)
      c.removeEventListener("webglcontextrestored", restored)
      current?.dispose()
    }
  }, [])

  // the clouds over the world: the model's grid with each city's own report painted in — rebuilt only when the grid or
  // a city's sky changes
  const skies = useMemo(() => cities.map((c) => ({ lat: c.lat, lon: c.lon, sky: c.sky })), [cities])
  const skyKey = JSON.stringify(skies)
  const skiesRef = useRef(skies)
  skiesRef.current = skies
  const cloudData = useMemo(() => (clouds || skiesRef.current.some((c) => c.sky) ? cloudField(clouds, skiesRef.current) : null), [clouds, skyKey])
  const stormy = useMemo(() => {
    const data = cloudData?.data
    if (!data) return false
    for (let k = 3; k < data.length; k += 4) if (data[k] > 0) return true
    return false
  }, [cloudData])

  const { w, h } = size
  // never under a device pixel per CSS pixel (a zoomed-out window), at most DPR_MAX — less where the GPU cannot keep up
  const dpr = typeof window !== "undefined" ? Math.max(1, Math.min(dprCap, window.devicePixelRatio || 1)) : 1
  const noted = useCallback((c: GlobeCity) => (musicMode && c.music) || c.id === playing, [musicMode, playing])
  const pillW = useMemo(() => new Map(cities.map((c) => [c.id, pillWidth(c.name, c.temp?.text ?? null, noted(c) ? NOTE_PX : 0)])), [cities, noted])
  const chipW = useMemo(() => new Map(cities.flatMap((c) => (c.temp ? [[c.id, chipWidth(c.temp.short)] as const] : []))), [cities])
  const night = useMemo(() => new Set(cities.filter((c) => sunCosAt(c.lat, c.lon, sun) < NIGHT_COS).map((c) => c.id)), [cities, sun])

  // everything layout() needs from the latest render
  const data = useRef({ showClouds, selected, sun, pillW, chipW, w, h, dpr, reserveBottom, musicMode, playing, avoid, pin, iss, issSelected, issClock, gl: null as GlobeGl | null })
  data.current = { showClouds, selected, sun, pillW, chipW, w, h, dpr, reserveBottom, musicMode, playing, avoid, pin, iss, issSelected, issClock, gl: gl && gl !== "none" ? gl : null }
  const els = useRef(new Map<string, CityEls>())
  /** where each label sat a moment ago (full pills and compact chips apart), so it holds its place as the globe moves */
  const sidesRef = useRef(new Map<string, LabelSide>())
  const chipSidesRef = useRef(new Map<string, LabelSide>())
  /** the markers shown a moment ago: they keep their place before new ones of the same tier */
  const shownRef = useRef(new Set<string>())
  /** a frame asked for (a bake under way, a sharp picture fading in) */
  const frameRef = useRef<number | null>(null)
  /** the sharp detail of the part in view */
  const detailRef = useRef<DetailLoader | null>(null)
  const fallbackRefs = useRef<{ sphere: SVGCircleElement | null; grid: SVGPathElement | null; land: SVGPathElement | null }>({ sphere: null, grid: null, land: null })

  /** Places the pin and the ISS (and its path) for the camera and the moment now: on their own as the ISS moves on, or
   *  with everything else (layout). */
  const placeOverlays = useCallback(() => {
    const d = data.current, cam = controller.camera
    const r = FIT * Math.min(d.w, d.h) * cam.zoom, cx = d.w / 2, cy = d.h / 2
    const at = (lat: number, lon: number): [number, number] | null => {
      const [x, y, z] = toCam(unit(lat, lon), cam)
      return z > 0.02 ? [cx + r * x, cy - r * y] : null
    }
    const pinEl = pinRef.current
    if (pinEl) {
      const p = d.pin && d.w ? at(d.pin.lat, d.pin.lon) : null
      pinEl.style.display = p ? "" : "none"
      if (p) pinEl.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`)
    }
    const g = issRef.current, craft = issCraftRef.current, past = issPastRef.current, next = issNextRef.current
    const foot = issFootRef.current, plumb = issPlumbRef.current, ground = issGroundRef.current, beacon = issBeaconRef.current
    if (!g || !craft || !past || !next || !foot || !plumb || !ground || !beacon) return
    const el = d.iss, now = d.issClock ? d.issClock() : Date.now()
    const here = el && d.w ? issAt(el, now) : null
    if (!el || !here) {
      g.style.display = ground.style.display = beacon.style.display = "none"
      if (issCanvasRef.current) issCanvasRef.current.style.display = "none"
      for (const e of [past, next, foot, plumb]) e.setAttribute("d", "")
      return
    }
    // the station drawn at its height, k Earth radii from the centre: hidden only where the Earth's disk is in front
    const k = 1 + here.altKm / EARTH_KM
    const aloft = (lat: number, lon: number): [number, number] | null => {
      const [x, y, z] = toCam(unit(lat, lon), cam)
      return z < 0 && (x * x + y * y) * k * k < 1 ? null : [cx + r * k * x, cy - r * k * y]
    }
    let tr = issTrack.current
    if (!tr || tr.el !== el || Math.abs(now - tr.at) > ISS_TRACK_EVERY_MS) {
      tr = { el, at: now, pts: groundTrack(el, now - ISS_PAST_MIN * 60_000, now + ISS_NEXT_MIN * 60_000, ISS_TRACK_STEP_MS) }
      issTrack.current = tr
    }
    // a line through points in pieces, broken where they are hidden; a whole ring closed
    const path = (pts: ReadonlyArray<{ lat: number; lon: number }>, place: typeof at, ring = false): string => {
      let out = "", down = false, broken = false
      for (const q of pts) {
        const s = place(q.lat, q.lon)
        if (!s) { down = false; broken = true; continue }
        out += `${down ? "L" : "M"}${s[0].toFixed(1)} ${s[1].toFixed(1)}`
        down = true
      }
      return ring && !broken ? `${out}Z` : out
    }
    past.setAttribute("d", path([...tr.pts.filter((q) => q.tMs < now), here], aloft))
    next.setAttribute("d", path([here, ...tr.pts.filter((q) => q.tMs > now)], aloft))
    // the ground its crew can see (within the horizon from its height), while it is chosen
    foot.setAttribute("d", d.issSelected ? path(smallCircle(here.lat, here.lon, Math.acos(1 / k), ISS_FOOT_STEPS), at, true) : "")
    const p = aloft(here.lat, here.lon), gp = at(here.lat, here.lon)
    g.style.display = p ? "" : "none"
    ground.style.display = gp ? "" : "none"
    if (gp) { ground.setAttribute("cx", gp[0].toFixed(1)); ground.setAttribute("cy", gp[1].toFixed(1)) }
    plumb.setAttribute("d", p && gp ? `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${gp[0].toFixed(1)} ${gp[1].toFixed(1)}` : "")
    beacon.style.display = p && d.issSelected ? "" : "none"
    const cv = issCanvasRef.current, gl3 = issGl.current
    if (cv) cv.style.display = p && gl3 ? "" : "none"
    if (!p) return
    const grow = Math.min(ISS_SCALE_MAX, 1 + (cam.zoom - 1) * ISS_SCALE_PER_ZOOM)
    g.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) scale(${grow.toFixed(2)})`)
    if (d.issSelected) beacon.style.transform = `translate3d(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px, 0)`
    // in the Earth's shadow (behind the Earth from the sun, inside the shadow's cylinder) the station dims
    const s = unit(d.sun.lat, d.sun.lon), u = unit(here.lat, here.lon), along = k * (u[0] * s[0] + u[1] * s[1] + u[2] * s[2])
    const dark = along < 0 && k * k - along * along < 1
    g.classList.toggle("eclipsed", dark)
    if (gl3 && cv) {
      // the station in 3D, in its real attitude as it flies, lit by the sun
      const f = issFrame(el, now), c = (v: readonly [number, number, number]) => toCam([v[0], v[1], v[2]], cam)
      gl3.draw({ forward: c(f.forward), truss: c(f.truss), nadir: c(f.nadir), sun: c(s), lit: !dark, pxPerM: ISS_PX_PER_M * grow, dpr: d.dpr })
      cv.style.transform = `translate3d(${(p[0] - ISS_CANVAS_PX / 2).toFixed(1)}px, ${(p[1] - ISS_CANVAS_PX / 2).toFixed(1)}px, 0)`
      return
    }
    // without WebGL, the drawn station: its truss across its path, as the real one flies
    const ahead = issAt(el, now + 20_000), q = aloft(ahead.lat, ahead.lon)
    if (q) craft.setAttribute("transform", `rotate(${(Math.atan2(q[0] - p[0], p[1] - q[1]) / RAD).toFixed(1)})`)
  }, [controller])

  /** Writes the current camera's positions into the elements, and draws the GPU layer. */
  const layout = useCallback(() => {
    const d = data.current
    if (!d.w || !d.h) return
    const cam = controller.camera
    const r = FIT * Math.min(d.w, d.h) * cam.zoom, cx = d.w / 2, cy = d.h / 2
    const still = reducedMotion()
    const now = performance.now()
    const tS = still ? 0 : (now / 1000) % 100_000
    d.gl?.draw({ width: Math.round(d.w * d.dpr), height: Math.round(d.h * d.dpr), cx: cx * d.dpr, cy: cy * d.dpr, r: r * d.dpr, view: cam, sun: d.sun, timeS: tS, clouds: d.showClouds, whole: still, lightning: cam.zoom >= LIGHTNING_ZOOM })
    detailRef.current?.view(cam, { w: d.w * d.dpr, h: d.h * d.dpr, r: r * d.dpr, cx: cx * d.dpr, cy: cy * d.dpr })
    windView.current?.view(cam, { w: d.w, h: d.h, cx, cy, r, dpr: d.dpr })
    placeOverlays()
    const fb = fallbackRefs.current
    if (fb.land) {
      fb.sphere?.setAttribute("cx", String(cx)); fb.sphere?.setAttribute("cy", String(cy)); fb.sphere?.setAttribute("r", r.toFixed(1))
      fb.grid?.setAttribute("d", graticulePath(cam, r, cx, cy))
      fb.land.setAttribute("d", globeLandPath(WORLD_LAND, cam, r, cx, cy))
    }

    // cities: where each stands, and which show at this zoom
    const cands: Array<{ id: string; c: CityEls; x: number; y: number; C: Vec3; rank: number; forced: boolean }> = []
    for (const [id, c] of els.current) {
      const C = toCam(unit(c.lat, c.lon), cam)
      const x = cx + r * C[0], y = cy - r * C[1]
      const forced = id === d.selected || id === d.playing
      const featured = d.musicMode && c.music
      if (C[2] <= 0.02 || x < -40 || x > d.w + 40 || y < -40 || y > d.h + 40 || (!forced && !featured && cam.zoom < TIER_ZOOM[c.tier])) {
        hideCity(c)
        continue
      }
      // the selected city, the one playing, the music cities while the music is on, then by tier; within a tier the ones
      // already shown, then the ones nearest the middle of the view
      const rank = id === d.selected ? -2 : id === d.playing ? -1 : (featured ? 0 : 10) + c.tier * 2 + (shownRef.current.has(id) ? 0 : 1) + (1 - C[2])
      cands.push({ id, c, x, y, C, rank, forced })
    }
    cands.sort((a, b) => a.rank - b.rank)
    const keep = spreadMarkers(cands, MARKER_GAP_PX, cands.map((k) => k.forced))

    // the markers that keep their place: the ring lying on the ground around each
    const items: Array<{ id: string; x: number; y: number; marker: LabelBox; w: number }> = []
    const shown = new Set<string>()
    // (cast: assigned in the loop below, which TypeScript does not follow)
    let wavesAt = null as [number, number] | null
    const m = MARKER_PX + 3
    cands.forEach(({ id, c, x, y, C }, k) => {
      if (!keep[k]) { hideCity(c); return }
      shown.add(id)
      if (id === d.playing) wavesAt = [x, y]
      c.g.style.display = ""
      c.g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
      // east and north along the ground, in the camera's frame: the ring is drawn in the ground's own plane
      const lat = c.lat * RAD, lon = c.lon * RAD
      const E = toCam([-Math.sin(lon), Math.cos(lon), 0], cam)
      const N = toCam([-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)], cam)
      for (const [poly, px] of c.rings) {
        const alpha = px / r, ca = Math.cos(alpha), sa = Math.sin(alpha)
        let pts = ""
        for (const [co, si] of RING_TRIG) {
          const qx = C[0] * ca + (E[0] * co + N[0] * si) * sa, qy = C[1] * ca + (E[1] * co + N[1] * si) * sa
          pts += `${(cx + r * qx - x).toFixed(2)},${(cy - r * qy - y).toFixed(2)} `
        }
        poly.setAttribute("points", pts)
      }
      items.push({ id, x, y, w: d.pillW.get(id) ?? 80, marker: [-m, -m, m, m] })
    })
    shownRef.current = shown
    const wv = wavesRef.current
    if (wv) {
      wv.style.display = wavesAt ? "" : "none"
      if (wavesAt) wv.style.transform = `translate3d(${wavesAt[0].toFixed(1)}px, ${wavesAt[1].toFixed(1)}px, 0)`
    }

    // labels, in the same order: the full pill where it fits, clear of every marker, every other label and the panels,
    // each held where it was while it still fits; then, where it did not, the temperature alone
    const view = { width: d.w, height: d.h, reserveBottom: d.reserveBottom + 8 }
    const full = placeLabels(items, d.avoid, items.map((it) => sidesRef.current.get(it.id) ?? null), view)
    const taken: LabelBox[] = [...d.avoid]
    const rest: typeof items = []
    items.forEach((it, i) => {
      const side = full[i], cw = d.chipW.get(it.id)
      if (!side && cw != null) { rest.push({ ...it, w: cw }); return }
      taken.push(abs(it.marker, it.x, it.y))
      if (side) taken.push(abs(pillBox(side, it), it.x, it.y))
    })
    const chips = placeLabels(rest, taken, rest.map((it) => chipSidesRef.current.get(it.id) ?? null), view)

    const nextFull = new Map<string, LabelSide>(), nextChip = new Map<string, LabelSide>()
    const unlabelled = new Set(items.map((it) => it.id))
    const show = (it: (typeof items)[number], side: LabelSide, compact: boolean) => {
      const c = els.current.get(it.id), pill = c?.pill
      if (!c || !pill) return
      unlabelled.delete(it.id)
      if (compact) nextChip.set(it.id, side)
      else nextFull.set(it.id, side)
      if (c.compact !== compact) { c.compact = compact; pill.classList.toggle("compact", compact); pill.style.minWidth = `${it.w}px` }
      const b = pillBox(side, it)
      pill.style.display = ""
      pill.style.transform = `translate3d(${(it.x + b[0]).toFixed(1)}px, ${(it.y + b[1]).toFixed(1)}px, 0)`
    }
    items.forEach((it, i) => { const side = full[i]; if (side) show(it, side, false) })
    rest.forEach((it, j) => { const side = chips[j]; if (side) show(it, side, true) })
    for (const id of unlabelled) { const pill = els.current.get(id)?.pill; if (pill) pill.style.display = "none" }
    sidesRef.current = nextFull
    chipSidesRef.current = nextChip

    // another frame while the clouds on show are being baked or a sharp picture fades in
    if (((d.showClouds && d.gl?.busy) || d.gl?.fading) && frameRef.current == null) {
      frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; layoutRef.current() })
    }
  }, [controller, placeOverlays])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(() => () => { if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current) }, [])

  // new clouds are drawn at once, not at the next move (the globe may be standing still)
  useEffect(() => { if (gl && gl !== "none") { gl.setClouds(cloudData); layout() } }, [gl, cloudData, layout])
  useEffect(() => { if (gl && gl !== "none") { gl.setSatellite(satellite); layout() } }, [gl, satellite, layout])

  // the sharp pictures: NASA's picture of the whole world once, and the detail of the part in view (the drawn colours
  // stay where the pictures cannot be had)
  const onDetailRef = useRef(onDetail)
  onDetailRef.current = onDetail
  // both asked for at once, from the start: NASA takes seconds to answer, so they come while the globe is made
  useEffect(() => {
    if (typeof WebGL2RenderingContext === "undefined") return
    void tiles.base()
    void tiles.bathymetry()
  }, [tiles])
  useEffect(() => {
    if (!gl || gl === "none") return
    let live = true
    const loader = new DetailLoader(gl, tiles, () => layoutRef.current(), (st) => onDetailRef.current?.(st))
    detailRef.current = loader
    void tiles.base().then(async (bytes) => {
      if (!live) return
      if (!bytes) { loader.photoFailed("NASA base image unavailable"); return }
      const img = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
      if (live) { gl.setPhoto(img); loader.photoShown(); layoutRef.current() }
      img.close()
      // then the sea floor's relief, for the sea's colour (the drawn sea stays where it cannot be had)
      const bed = await tiles.bathymetry()
      if (!live || !bed) return
      const bedImg = await createImageBitmap(new Blob([bed as BlobPart], { type: "image/jpeg" }))
      if (live) { gl.setBathymetry(bedImg); layoutRef.current() }
      bedImg.close()
    }).catch((err: unknown) => { if (live) loader.photoFailed(`NASA base image could not be decoded (${err instanceof Error ? err.message : "decode failed"})`) })
    return () => { live = false; loader.dispose(); detailRef.current = null }
  }, [gl, tiles])
  useEffect(() => { detailRef.current?.setHour(satellite?.timeMs ?? null) }, [gl, satellite])
  useEffect(() => { detailRef.current?.setClouds(showClouds) }, [gl, showClouds])

  // after every render: find the elements, then place them
  useLayoutEffect(() => {
    const svg = svgRef.current, pills = pillsRef.current
    if (!svg || !pills) return
    const found = new Map<string, CityEls>()
    for (const g of svg.querySelectorAll<SVGGElement>("g.city")) {
      found.set(g.dataset.city ?? "", {
        g, lat: Number(g.dataset.lat), lon: Number(g.dataset.lon), pill: null, compact: null,
        tier: (Number(g.dataset.tier) || 1) as CityTier, music: g.dataset.music === "1",
        rings: [...g.querySelectorAll<SVGPolygonElement>("polygon[data-px]")].map((p): [SVGPolygonElement, number] => [p, Number(p.dataset.px)]),
      })
    }
    for (const p of pills.querySelectorAll<HTMLElement>(".pill-city")) { const c = found.get(p.dataset.city ?? ""); if (c) c.pill = p }
    els.current = found
    layout()
  })
  useEffect(() => controller.subscribe(() => layout()), [controller, layout])
  // the GPU keeping up? While the camera moves, a probe times the animation frames — not the moves, which come at the
  // pace of the key repeat or the wheel — and steps the pixel ratio coarser where they lag, finer again once they keep up
  useEffect(() => {
    let raf = 0, last = 0, movedAt = 0, pace = PACE_START
    const tick = (t: number) => {
      raf = 0
      if (t - movedAt > MOVING_MS || document.hidden) { last = 0; return }
      if (last) {
        const cur = data.current.dpr, top = Math.min(DPR_MAX, window.devicePixelRatio || 1)
        const next = paceFrame(pace, t - last, cur < top)
        pace = next.pace
        if (next.step < 0 && cur > 1) setDprCap(Math.max(1, cur - DPR_STEP))
        else if (next.step > 0) setDprCap(Math.min(top, cur + DPR_STEP))
      }
      last = t
      raf = window.requestAnimationFrame(tick)
    }
    const off = controller.subscribe(() => {
      movedAt = performance.now()
      if (!raf && data.current.gl) raf = window.requestAnimationFrame(tick)
    })
    return () => { off(); if (raf) window.cancelAnimationFrame(raf) }
  }, [controller])
  // lightning in a storm flickers while it shows
  useEffect(() => {
    if (!showClouds || !stormy || reducedMotion()) return
    const id = window.setInterval(() => { if (!document.hidden && controller.camera.zoom >= LIGHTNING_ZOOM) layout() }, STORM_MS)
    return () => window.clearInterval(id)
  }, [showClouds, stormy, layout, controller])
  // the wind, on its own canvas (made the first time there is wind to draw)
  useEffect(() => {
    if (wind && !windView.current && windRef.current && gl && gl !== "none") windView.current = WindView.create(windRef.current)
    windView.current?.setFrame(wind)
    if (wind) layout()
  }, [wind, gl, layout])
  useEffect(() => () => { windView.current?.dispose(); windView.current = null }, [])
  // the 3D station, on its own canvas: made the first time the ISS is shown (the drawn one stands in without WebGL2)
  useEffect(() => {
    if (!iss || issGl.current || !issCanvasRef.current) return
    issGl.current = IssGl.create(issCanvasRef.current)
    issCraftRef.current?.style.setProperty("display", issGl.current ? "none" : "")
    placeOverlays()
  }, [iss, placeOverlays])
  useEffect(() => () => { issGl.current?.dispose(); issGl.current = null }, [])
  // its context lost (a GPU reset), the drawn station stands in until the context is back
  useEffect(() => {
    const cv = issCanvasRef.current
    if (!cv) return
    const show = (gl3: IssGl | null) => {
      issGl.current = gl3
      issCraftRef.current?.style.setProperty("display", gl3 ? "none" : "")
      placeOverlays()
    }
    const lost = (e: Event) => { e.preventDefault(); show(null) }
    const restored = () => show(IssGl.create(cv))
    cv.addEventListener("webglcontextlost", lost)
    cv.addEventListener("webglcontextrestored", restored)
    return () => { cv.removeEventListener("webglcontextlost", lost); cv.removeEventListener("webglcontextrestored", restored) }
  }, [placeOverlays])
  // the ISS moves on by itself: it (and the pin) are placed again — never the globe drawn again
  useEffect(() => {
    placeOverlays()
    if (!iss) return
    let id = 0
    const tick = () => {
      if (!document.hidden) placeOverlays()
      const d = data.current, r = FIT * Math.min(d.w, d.h) * controller.camera.zoom
      id = window.setTimeout(tick, Math.min(ISS_MAX_MS, Math.max(ISS_MIN_MS, (ISS_STEP_PX / (ISS_RAD_PER_S * Math.max(1, r))) * 1000)))
    }
    id = window.setTimeout(tick, ISS_MIN_MS)
    return () => window.clearTimeout(id)
  }, [iss, placeOverlays, controller])

  // the wheel zooms the globe, never the page (a passive React listener could not stop the page scrolling)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); controller.set(zoomed(controller.camera, Math.exp(-ev.deltaY * 0.0015))) }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [controller])

  // one finger (or the mouse) turns the globe; a second makes it a pinch, which zooms it (gesture.ts) until a finger
  // lifts, the one left then turning it on once it moves as far as a drag
  const drag = useRef<{ x: number; y: number; camera: GlobeCamera; moved: boolean } | null>(null)
  const touches = useRef(new Map<number, Point>())
  const pinch = useRef<{ spread: number; zoom: number } | null>(null)
  /** this gesture has been a pinch: lifting its fingers opens no city under them */
  const pinchedNow = useRef(false)
  const [dragging, setDragging] = useState(false)
  const pair = (): [Point, Point] | null => {
    const [a, b] = touches.current.values()
    return a && b ? [a, b] : null
  }
  const capture = (el: HTMLDivElement, id: number) => {
    // a touch that ended unseen can no longer be captured: it is forgotten
    try { if (!el.hasPointerCapture(id)) el.setPointerCapture(id) } catch { touches.current.delete(id) }
  }
  const startPinch = (el: HTMLDivElement) => {
    for (const id of [...touches.current.keys()]) capture(el, id)
    const p = pair()
    if (!p) return
    pinch.current = { spread: spread(...p), zoom: controller.camera.zoom }
    pinchedNow.current = true
    setDragging(true)
  }
  const onDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return
    // the first touch of a new gesture: any touch still listed has ended out of sight
    if (ev.isPrimary) { touches.current.clear(); pinch.current = null; pinchedNow.current = false }
    touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    if (touches.current.size >= 2) startPinch(ev.currentTarget)
    else drag.current = { x: ev.clientX, y: ev.clientY, camera: controller.camera, moved: false }
  }
  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (touches.current.has(ev.pointerId)) touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    const pn = pinch.current
    if (pn) {
      // the zoom alone, the globe left where it is now: a follow of the ISS goes on under the fingers
      const p = pair()
      if (p) controller.set(pinched(controller.camera, pn.zoom, pinchFactor(pn.spread, spread(...p))))
      return
    }
    const dr = drag.current
    if (!dr || ev.buttons === 0) return
    const slop = ev.pointerType === "mouse" ? DRAG_START_PX : TOUCH_DRAG_START_PX
    if (!dr.moved && Math.hypot(ev.clientX - dr.x, ev.clientY - dr.y) < slop) return
    // the pointer is captured only once a drag starts: a plain click still reaches the city under it
    if (!dr.moved) { dr.moved = true; setDragging(true); capture(ev.currentTarget, ev.pointerId) }
    const degPerPx = 180 / Math.PI / (FIT * Math.min(w, h) * dr.camera.zoom)
    controller.set({ ...dr.camera, lon: wrapLon(dr.camera.lon - (ev.clientX - dr.x) * degPerPx), lat: clampLat(dr.camera.lat + (ev.clientY - dr.y) * degPerPx) })
  }
  const onUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(ev.pointerId)
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId)
    if (pinch.current) {
      if (touches.current.size >= 2) { startPinch(ev.currentTarget); return }
      pinch.current = null
      const [rest] = touches.current.values()
      if (rest) { drag.current = { ...rest, camera: controller.camera, moved: false }; return }
    }
    setDragging(false)
    // a click that never turned the globe still reaches the city under it
    setTimeout(() => { drag.current = null }, 0)
  }
  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return // a focused city handles its own keys
    const cam = controller.camera, step = 10 / cam.zoom
    const move = (c: GlobeCamera) => { ev.preventDefault(); controller.set(c) }
    if (ev.key === "+" || ev.key === "=") return move(zoomed(cam, 1.25))
    if (ev.key === "-") return move(zoomed(cam, 0.8))
    const k: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = k[ev.key]
    if (m) move({ ...cam, lon: wrapLon(cam.lon + m[0]), lat: clampLat(cam.lat + m[1]) })
  }
  const open = (id: string) => { if (!drag.current?.moved && !pinchedNow.current) onCity(id) }

  return (
    <div ref={stageRef} className={`globe-stage${dragging ? " dragging" : ""}`} role="application" tabIndex={0}
      aria-label="Globe — drag or use the arrow keys to turn it, pinch, scroll or + / − to zoom; Tab moves between the labelled cities"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <canvas ref={canvasRef} className="globe-gl" width={Math.max(1, Math.round(w * dpr))} height={Math.max(1, Math.round(h * dpr))} style={{ width: w, height: h }} />
      <canvas ref={windRef} className="globe-wind" width={Math.max(1, Math.round(w * dpr))} height={Math.max(1, Math.round(h * dpr))}
        style={{ width: w, height: h, display: wind ? undefined : "none" }} aria-hidden="true" />
      <svg ref={svgRef} className="globe-svg" width={w} height={h} viewBox={`0 0 ${w || 1} ${h || 1}`}>
        <defs>
          <radialGradient id="g-iss-halo">
            <stop offset="0" stopColor="#d6efff" stopOpacity="0.42" />
            <stop offset="0.45" stopColor="#8fcfff" stopOpacity="0.14" />
            <stop offset="1" stopColor="#8fcfff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="g-iss-array" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#eec27a" />
            <stop offset="0.5" stopColor="#b98236" />
            <stop offset="1" stopColor="#8a5824" />
          </linearGradient>
          <radialGradient id="g-citylight">
            <stop offset="0" stopColor="#e9eeff" stopOpacity="0.7" />
            <stop offset="0.45" stopColor="#b9c6ff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#8d97dc" stopOpacity="0" />
          </radialGradient>
        </defs>
        {gl === "none" && (
          <g className="globe-fallback">
            <circle className="sphere" ref={(el) => { fallbackRefs.current.sphere = el }} />
            <path className="graticule" ref={(el) => { fallbackRefs.current.grid = el }} />
            <path className="land" ref={(el) => { fallbackRefs.current.land = el }} />
          </g>
        )}
        <g className={`iss-path${issSelected ? " selected" : ""}`} style={{ display: iss ? undefined : "none" }} aria-hidden="true">
          <path ref={issFootRef} className="iss-foot" />
          <path ref={issPastRef} className="iss-track past" />
          <path ref={issNextRef} className="iss-track" />
          <path ref={issPlumbRef} className="iss-plumb" />
          <circle ref={issGroundRef} className="iss-ground" r={2.2} style={{ display: "none" }} />
        </g>
        <g>
          {cities.map((c) => (
            <g key={c.id} data-city={c.id} data-lat={c.lat} data-lon={c.lon} data-tier={c.tier} data-music={c.music ? "1" : "0"} style={{ display: "none" }} onClick={() => open(c.id)}
              className={`city${selected === c.id ? " selected" : ""}${night.has(c.id) ? " night" : ""}${musicMode && c.music ? " music" : ""}${playing === c.id ? " playing" : ""}`}>
              <title>{`${c.name}${c.note ? `\n${c.note}` : ""}`}</title>
              {night.has(c.id) && <circle className="citylight" r={MARKER_PX + 7} />}
              {selected === c.id && <polygon className="sel" data-px={MARKER_PX + 5} />}
              <polygon className="ring" data-px={MARKER_PX} />
              <circle className="dot" r={1.6} />
              <circle className="hit" r={11} />
            </g>
          ))}
        </g>
        <g ref={pinRef} className="pin" style={{ display: "none" }} aria-hidden="true">
          <path className="pin-shape" d="M0 0C-1.6-5-7-8.6-7-13.6a7 7 0 1 1 14 0C7-8.6 1.6-5 0 0Z" />
          <circle className="pin-hole" cy={-13.6} r={2.6} />
          {pin && <text className="pin-label" x={10} y={-12}>{pin.name}</text>}
        </g>
        <g ref={issRef} className={`iss${issSelected ? " selected" : ""}`} style={{ display: "none" }} role="button" tabIndex={iss ? 0 : -1}
          aria-label="The International Space Station" onClick={() => onIss?.()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onIss?.() } }}>
          <title>The International Space Station, live: where it is, and the song of the day it picked</title>
          <circle className="iss-hit" r={30} />
          <circle className="iss-halo" r={36} />
          <g ref={issCraftRef} className="iss-craft">
            <path className="iss-array" d={ISS_ARRAYS} />
            <path className="iss-cells" d={ISS_CELLS} />
            <rect className="iss-truss" x={-21.5} y={-0.85} width={43} height={1.7} rx={0.5} />
            <path className="iss-rad" d="M-6.6 1.3h2.6v5.4h-2.6zM4 1.3h2.6v5.4H4z" />
            <rect className="iss-module" x={-1.6} y={-9.5} width={3.2} height={19} rx={1.6} />
            <rect className="iss-module" x={-5} y={-4.4} width={10} height={2.6} rx={1.3} />
            <path className="iss-array small" d="M-6.8 7.4h4.4v1.8h-4.4zM2.4 7.4h4.4v1.8H2.4z" />
          </g>
          <g className="iss-tag" transform="translate(34 -26)">
            <rect x={0} y={-7.5} width={28} height={15} rx={7.5} />
            <text x={14} y={3.4} textAnchor="middle">ISS</text>
          </g>
        </g>
      </svg>
      <div ref={wavesRef} className="playing-waves" style={{ display: "none" }} aria-hidden="true"><i /><i /><i /></div>
      <div ref={issBeaconRef} className="iss-beacon" style={{ display: "none" }} aria-hidden="true"><i /><i /></div>
      <canvas ref={issCanvasRef} className="iss-3d" style={{ display: "none", width: ISS_CANVAS_PX, height: ISS_CANVAS_PX }} aria-hidden="true" />
      <div ref={pillsRef} className="globe-pills">
        {cities.map((c) => {
          const temp = c.temp?.text ?? null
          return (
            <button key={c.id} type="button" data-city={c.id} style={{ display: "none", minWidth: pillW.get(c.id), ["--tc" as string]: c.temp ? tempColor(c.temp.f) : undefined }}
              className={`pill-city${selected === c.id ? " selected" : ""}${noted(c) ? " noted" : ""}${playing === c.id ? " playing" : ""}`}
              onClick={() => open(c.id)} aria-label={`${c.name}${temp ? `, ${temp}` : ""}${c.music ? ", has music" : ""}${c.note ? `. ${c.note}` : ""}`}
              title={`${c.name}${c.note ? `\n${c.note}` : ""}`}>
              {noted(c) && (playing === c.id
                ? <span className="pc-note pc-eq" aria-hidden="true"><i /><i /><i /></span>
                : <span className="pc-note" aria-hidden="true">♪</span>)}
              <span className="pc-name">{c.name}</span>
              {temp && <span className="pc-temp">{temp}</span>}
              {c.temp && <span className="pc-chip">{c.temp.short}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
})
