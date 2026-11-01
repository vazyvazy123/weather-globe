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
import type { SatField } from "../globe/satClouds"
import { DetailLoader, type DetailStatus } from "../globe/detail"
import type { TileFetcher } from "../data/tileFetcher"
import { TIER_ZOOM, type CityTier } from "../data/cities"

// The globe, in three layers on one orthographic projection (screen pixels):
//  - the GPU (globeGl.ts): the surface as NASA's Blue Marble shows it, the sun's real day and night, the clouds where a
//    satellite saw them (the weather model's beyond its image), the atmosphere — and, once the view stands still zoomed
//    in, the sharp detail of the part in view (detail.ts: the surface's tiles, the clouds sharpened by the infrared of
//    the satellite overhead);
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
/** the ring's radius on the ground, as it shows face-on (px) */
const MARKER_PX = 4.2
/** markers closer than this crowd each other: the less important one is not shown */
const MARKER_GAP_PX = 16
/** the room a pill gives its music note */
const NOTE_PX = 14
const RING_POINTS = 24
const RING_TRIG = Array.from({ length: RING_POINTS }, (_, k) => [Math.cos((2 * Math.PI * k) / RING_POINTS), Math.sin((2 * Math.PI * k) / RING_POINTS)])
/** lightning flickers this often while a storm shows */
const STORM_MS = 200
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
const hideCity = (c: CityEls) => { c.g.style.display = "none"; if (c.pill) c.pill.style.display = "none" }

export const Globe = memo(function Globe({ cities, clouds, satellite, selected, onCity, controller, showClouds, tiles, onGpu, onDetail, reserveBottom = 0,
  musicMode = false, playing = null, avoid = NO_BOXES }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
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
    let current = GlobeGl.create(c)
    setGl(current ?? "none")
    const lost = (e: Event) => { e.preventDefault(); setGl("none") }
    const restored = () => {
      if (!live || restores >= 2) return
      restores++
      const next = GlobeGl.create(c)
      if (!live) { next?.dispose(); return }
      if (next) { current = next; setGl(next) }
      else setGl("none")
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
  // never under a device pixel per CSS pixel (a zoomed-out window), at most DPR_MAX
  const dpr = typeof window !== "undefined" ? Math.max(1, Math.min(DPR_MAX, window.devicePixelRatio || 1)) : 1
  const noted = useCallback((c: GlobeCity) => (musicMode && c.music) || c.id === playing, [musicMode, playing])
  const pillW = useMemo(() => new Map(cities.map((c) => [c.id, pillWidth(c.name, c.temp?.text ?? null, noted(c) ? NOTE_PX : 0)])), [cities, noted])
  const chipW = useMemo(() => new Map(cities.flatMap((c) => (c.temp ? [[c.id, chipWidth(c.temp.short)] as const] : []))), [cities])
  const night = useMemo(() => new Set(cities.filter((c) => sunCosAt(c.lat, c.lon, sun) < NIGHT_COS).map((c) => c.id)), [cities, sun])

  // everything layout() needs from the latest render
  const data = useRef({ showClouds, selected, sun, pillW, chipW, w, h, dpr, reserveBottom, musicMode, playing, avoid, gl: null as GlobeGl | null })
  data.current = { showClouds, selected, sun, pillW, chipW, w, h, dpr, reserveBottom, musicMode, playing, avoid, gl: gl && gl !== "none" ? gl : null }
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

  /** Writes the current camera's positions into the elements, and draws the GPU layer. */
  const layout = useCallback(() => {
    const d = data.current
    if (!d.w || !d.h) return
    const cam = controller.camera
    const r = FIT * Math.min(d.w, d.h) * cam.zoom, cx = d.w / 2, cy = d.h / 2
    const still = reducedMotion()
    const tS = still ? 0 : (performance.now() / 1000) % 100_000
    d.gl?.draw({ width: Math.round(d.w * d.dpr), height: Math.round(d.h * d.dpr), cx: cx * d.dpr, cy: cy * d.dpr, r: r * d.dpr, view: cam, sun: d.sun, timeS: tS, clouds: d.showClouds, whole: still })
    detailRef.current?.view(cam, { w: d.w * d.dpr, h: d.h * d.dpr, r: r * d.dpr, cx: cx * d.dpr, cy: cy * d.dpr })
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
    const m = MARKER_PX + 3
    cands.forEach(({ id, c, x, y, C }, k) => {
      if (!keep[k]) { hideCity(c); return }
      shown.add(id)
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
  }, [controller])
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
  // lightning in a storm flickers while it shows
  useEffect(() => {
    if (!showClouds || !stormy || reducedMotion()) return
    const id = window.setInterval(() => { if (!document.hidden) layout() }, STORM_MS)
    return () => window.clearInterval(id)
  }, [showClouds, stormy, layout])

  // the wheel zooms the globe, never the page (a passive React listener could not stop the page scrolling)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); controller.set(zoomed(controller.camera, Math.exp(-ev.deltaY * 0.0015))) }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [controller])

  const drag = useRef<{ x: number; y: number; camera: GlobeCamera; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onDown = (ev: React.PointerEvent<HTMLDivElement>) => { if (ev.button === 0) drag.current = { x: ev.clientX, y: ev.clientY, camera: controller.camera, moved: false } }
  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const dr = drag.current
    if (!dr || ev.buttons === 0) return
    if (!dr.moved && Math.hypot(ev.clientX - dr.x, ev.clientY - dr.y) < DRAG_START_PX) return
    // the pointer is captured only once a drag starts: a plain click still reaches the city under it
    if (!dr.moved) { dr.moved = true; setDragging(true); ev.currentTarget.setPointerCapture(ev.pointerId) }
    const degPerPx = 180 / Math.PI / (FIT * Math.min(w, h) * dr.camera.zoom)
    controller.set({ ...dr.camera, lon: wrapLon(dr.camera.lon - (ev.clientX - dr.x) * degPerPx), lat: clampLat(dr.camera.lat + (ev.clientY - dr.y) * degPerPx) })
  }
  const onUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId)
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
  const open = (id: string) => { if (!drag.current?.moved) onCity(id) }

  return (
    <div ref={stageRef} className={`globe-stage${dragging ? " dragging" : ""}`} role="application" tabIndex={0}
      aria-label="Globe — drag or use the arrow keys to turn it, scroll or + / − to zoom; Tab moves between the labelled cities"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <canvas ref={canvasRef} className="globe-gl" width={Math.max(1, Math.round(w * dpr))} height={Math.max(1, Math.round(h * dpr))} style={{ width: w, height: h }} />
      <svg ref={svgRef} className="globe-svg" width={w} height={h} viewBox={`0 0 ${w || 1} ${h || 1}`}>
        <defs>
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
        <g>
          {cities.map((c) => (
            <g key={c.id} data-city={c.id} data-lat={c.lat} data-lon={c.lon} data-tier={c.tier} data-music={c.music ? "1" : "0"} style={{ display: "none" }} onClick={() => open(c.id)}
              className={`city${selected === c.id ? " selected" : ""}${night.has(c.id) ? " night" : ""}${musicMode && c.music ? " music" : ""}${playing === c.id ? " playing" : ""}`}>
              <title>{`${c.name}${c.note ? `\n${c.note}` : ""}`}</title>
              {night.has(c.id) && <circle className="citylight" r={MARKER_PX + 7} />}
              {playing === c.id && [0, 1, 2].map((k) => <circle key={k} className={`wave w${k}`} r={MARKER_PX + 2} />)}
              {selected === c.id && <polygon className="sel" data-px={MARKER_PX + 5} />}
              <polygon className="ring" data-px={MARKER_PX} />
              <circle className="dot" r={1.6} />
              <circle className="hit" r={11} />
            </g>
          ))}
        </g>
      </svg>
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
