// The globe's sharp detail of the part in view (data/tileFetcher.ts fetches and caches the tiles; globeGl.ts draws them):
//  - the land: NASA's Blue Marble tiles, kept in a cache on the GPU that the globe draws from at whatever level each
//    pixel needs (globeGl.ts). The view's tiles are planned while it moves (at most every MOVING_PLAN_MS): first the
//    coarser levels under it (a few tiles, so something sharp shows at once), then the view's own level from the middle
//    out; once those are in and the network is idle, the next level's tiles for the middle of the view are fetched
//    ahead, so zooming in finds them at hand. Nothing the cache holds is fetched again;
//  - the clouds, once the view stands still: the infrared of the satellite with the best view of the middle of the
//    picture (GOES-West, GOES-East or Himawari) at the hour of the world's cloud image, and by day its visible band of
//    the same hour, turned off the main thread (detailWorker.ts) into the clouds' fine structure and their look as a
//    camera sees them, rebuilt as the tiles come in. What is on show of another hour goes at once, of another satellite
//    (the same clouds) stays until the new one is built, and a part-built one waits a moment rather than leave holes in
//    the one on show.
// Nothing is asked while the view is wide enough for the world's own pictures. A tile that could not be had is asked
// again a minute later; the status says what is drawn, not what was asked.
import { CLOUD_MIN_LEVEL, CLOUD_SOURCES, SURFACE_MAX_LEVEL, SURFACE_MIN_LEVEL, TILE_PX, tileCols, tileRes, tileRows, tileSpan, type CloudSource, type TileAnswer, type TileReq } from "../geo/tiles"
import { subsolarPoint, sunCosAt } from "../geo/sun"
import type { GlobeCamera } from "./camera"
import type { GlobeGl } from "./globeGl"

const RAD = Math.PI / 180
/** degrees a pixel of the world's own pictures (4096 wide): finer than this on screen, the detail is worth asking for */
export const WORLD_DEG_PER_PX = 360 / 4096
/** a level's pixels may be this much coarser than the screen's */
const LEVEL_SLACK = 1.25
/** a plan spans at most this many tiles a side by default (the clouds' fewer, the land's as many as the GPU cache allows) */
export const MAX_SIDE = 8
/** the view has stood still this long: the clouds' detail is planned */
const STILL_MS = 150
/** while the view moves, its land is planned at most this often */
const MOVING_PLAN_MS = 90
/** the view's land tiles (its own level and the coarser ones under it) fill at most this share of the GPU cache, else a
 *  level coarser: room is left for the next level ahead */
const VIEW_SHARE = 0.8
/** the next level is fetched ahead for this share of the view's middle (what zooming in twice as close shows): at most
 *  AHEAD_MAX tiles at a time and AHEAD_PER_MIN a minute, and only while nothing else is asked */
const AHEAD_SHARE = 0.5
const AHEAD_MAX = 12
const AHEAD_PER_MIN = 48
/** a satellite is used out to this angle from the point below it */
export const MAX_VIEW_DEG = 72
/** the clouds' detail is rebuilt at most this often while its tiles come in */
const REBUILD_MS = 500
/** while an earlier detail of the clouds is on show, a part-built one waits at most this long for the rest */
const CLOUD_SHOW_WITHIN_MS = 900
/** the next level is not fetched ahead while this share of the minute's requests is spent */
const AHEAD_MAX_USAGE = 0.6
/** a tile refused because the minute's requests were spent is asked again after this */
const BUSY_RETRY_MS = 5000
/** the visible band is asked for where the sun stood at least this high over the middle of the view at the hour */
const VIS_SUN_COS = 0.08
/** tile pictures held in memory (the browser's cache keeps the surface tiles longer) */
const HELD_BYTES = 48e6

/** the frame in device pixels (y down), the globe's centre and radius */
export interface Frame { w: number; h: number; r: number; cx: number; cy: number }
/** a box of the world in degrees; east may pass 180° (it wraps) */
export interface Box { west: number; east: number; south: number; north: number }

/** The part of the globe in the frame — longitudes unwrapped round the camera's — a little wider; null when the whole
 *  disk fits in the frame or a pole is in view. */
export function visibleBox(cam: GlobeCamera, f: Frame): Box | null {
  if (f.r <= Math.min(f.cx, f.w - f.cx, f.cy, f.h - f.cy)) return null
  const p0 = cam.lat * RAD, sp0 = Math.sin(p0), cp0 = Math.cos(p0)
  const inFrame = (x: number, y: number) => x >= 0 && x <= f.w && y >= 0 && y <= f.h
  // a pole on the near side, in the frame: every longitude is in view
  for (const s of [1, -1]) {
    const y = f.cy - f.r * s * cp0
    if (s * sp0 > 0 && inFrame(f.cx, y)) return null
  }
  let w = Infinity, e = -Infinity, so = Infinity, no = -Infinity
  const add = (nx: number, ny: number, nz: number) => {
    const lat = Math.asin(Math.max(-1, Math.min(1, ny * cp0 + nz * sp0))) / RAD
    const dl = Math.atan2(nx, nz * cp0 - ny * sp0) / RAD
    w = Math.min(w, dl); e = Math.max(e, dl); so = Math.min(so, lat); no = Math.max(no, lat)
  }
  const N = 12
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const px = (i / N) * f.w, py = (j / N) * f.h
    const x = (px - f.cx) / f.r, y = (f.cy - py) / f.r, d2 = x * x + y * y
    if (d2 <= 1) add(x, y, Math.sqrt(1 - d2))
  }
  // the limb, where it crosses the frame
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * 2 * Math.PI, x = Math.cos(a), y = Math.sin(a)
    if (inFrame(f.cx + f.r * x, f.cy - f.r * y)) add(x, y, 0)
  }
  if (!Number.isFinite(w)) return null
  const mx = (e - w) * 0.08 + 0.5, my = (no - so) * 0.08 + 0.5
  return { west: cam.lon + w - mx, east: cam.lon + e + mx, south: Math.max(-90, so - my), north: Math.min(90, no + my) }
}

/** the coarsest level whose pixels are at most a little coarser than the screen's (degrees a device pixel) */
export function levelFor(degPerPx: number, min: number, max: number): number {
  const z = Math.ceil(Math.log2(tileRes(0) / (degPerPx * LEVEL_SLACK)))
  return Math.max(min, Math.min(max, z))
}

/** the tiles of a level that cover a box: a run of columns (they wrap round the world) and of rows, and their box */
export interface TilePlan { z: number; col0: number; cols: number; row0: number; rows: number; box: Box }

/** The tiles at level z over a box; null when more than `maxSide` a side would be needed. */
export function tilePlan(box: Box, z: number, maxSide = MAX_SIDE): TilePlan | null {
  const s = tileSpan(z)
  const col0 = Math.floor((box.west + 180) / s), col1 = Math.floor((box.east + 180 - 1e-9) / s)
  const row0 = Math.max(0, Math.floor((90 - box.north) / s)), row1 = Math.min(tileRows(z) - 1, Math.floor((90 - box.south - 1e-9) / s))
  const cols = col1 - col0 + 1, rows = row1 - row0 + 1
  if (cols > maxSide || rows > maxSide || cols < 1 || rows < 1) return null
  return { z, col0, cols, row0, rows, box: { west: -180 + col0 * s, east: -180 + (col1 + 1) * s, north: 90 - row0 * s, south: 90 - (row1 + 1) * s } }
}

export const planKey = (p: TilePlan): string => `${p.z}/${p.row0}/${((p.col0 % tileCols(p.z)) + tileCols(p.z)) % tileCols(p.z)}/${p.rows}x${p.cols}`

/** A plan's tiles, the middle first: where each goes in the mosaic (i across, j down) and its column on the grid. */
export function planTiles(p: TilePlan): Array<{ i: number; j: number; row: number; col: number }> {
  const n = tileCols(p.z), out: Array<{ i: number; j: number; row: number; col: number }> = []
  for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) out.push({ i, j, row: p.row0 + j, col: (((p.col0 + i) % n) + n) % n })
  const ci = (p.cols - 1) / 2, cj = (p.rows - 1) / 2
  return out.sort((a, b) => Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj))
}

/** The angle (°) between a point and the point below a satellite. */
export function sourceAngle(src: CloudSource, lat: number, lon: number): number {
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(lat * RAD) * Math.cos((lon - CLOUD_SOURCES[src].subLon) * RAD)))) / RAD
}

/** The satellite with the best view of a point; null when none sees it within MAX_VIEW_DEG. */
export function bestSource(lat: number, lon: number): CloudSource | null {
  let best: CloudSource | null = null, angle = MAX_VIEW_DEG
  for (const s of Object.keys(CLOUD_SOURCES) as CloudSource[]) {
    const a = sourceAngle(s, lat, lon)
    if (a < angle) { angle = a; best = s }
  }
  return best
}

/** each box blur's radius (pixels, applied twice each way) at level z: about one and a half of the world cloud map's
 *  pixels in all */
export const blurRadius = (z: number): number => Math.max(1, Math.round((1.5 * WORLD_DEG_PER_PX / tileRes(z) - 1) / 2))

/** the middle `share` of a box */
const middleOf = (b: Box, share: number): Box => {
  const lon = (b.west + b.east) / 2, lat = (b.south + b.north) / 2, dLon = ((b.east - b.west) * share) / 2, dLat = ((b.north - b.south) * share) / 2
  return { west: lon - dLon, east: lon + dLon, south: Math.max(-90, lat - dLat), north: Math.min(90, lat + dLat) }
}

export interface DetailStatus {
  /** NASA's picture of the whole world is in (else the land's colours are drawn) */
  photo: boolean
  photoError?: string | null
  /** the land in view: the world's picture is enough here ("off"), a sharper one is coming, at least part of it is on
   *  show, or none of it could be had */
  surface: "off" | "loading" | "sharp" | "failed"
  surfaceError?: string | null
  /** the clouds' sharpening in view: the satellite; the times of the pictures drawn (earliest, latest); the level; the
   *  tiles drawn with something in them, out of those wanted; whether every tile has been asked; and whether the
   *  visible band (the clouds as a camera sees them) is in */
  clouds: { source: CloudSource; fromMs: number; toMs: number; z: number; have: number; want: number; done: boolean; visible?: boolean; error?: string } | null
}

export interface TileApi {
  tile(req: TileReq): Promise<TileAnswer>
  /** the share of this minute's requests already made (0..1) */
  usage?(): number
}

interface Built { id: number; px?: Uint8Array; seen?: number; failed?: number; error?: string }
/** a tile's picture held in memory, and the time of the picture (clouds) */
interface Held { bytes: Uint8Array; timeMs?: number }
interface Ask { req: TileReq; generation: number; go: (h: Held | null) => void }
/** a cloud tile come in: where it goes in the mosaic, its picture and the time of it */
interface Got { x: number; y: number; key: string; bytes: Uint8Array; timeMs: number }

/** at most this many tiles asked of the tile fetcher at once (older asks wait; those of a view left behind are dropped) */
const MAX_ASKING = 8
/** a tile that could not be had now is asked again after this */
const RETRY_MS = 60_000
/** the clouds' detail is built on at most this many tiles a side (its working arrays grow with the square) */
export const MAX_SIDE_CLOUDS = 5
/** a build that has not answered in this long is given up */
const BUILD_TIMEOUT_MS = 30_000

const reqKey = (r: TileReq): string => (r.kind === "surface" ? `s/${r.z}/${r.row}/${r.col}` : `c/${r.source}${r.band === "vis" ? "/vis" : ""}/${r.timeMs}/${r.z}/${r.row}/${r.col}`)
type SurfaceReq = Extract<TileReq, { kind: "surface" }>

export class DetailLoader {
  private cam: GlobeCamera | null = null
  private frame: Frame | null = null
  private movedAt = 0
  private timer: number | null = null
  private landTimer: number | null = null
  private landPlannedAt = -Infinity
  private hourMs: number | null = null
  private cloudsOn = true
  /** the land's planning round: its generation (asks of an older round not yet sent are dropped), its level, the view's
   *  own tiles at that level, how many of them are not in yet and how many could not be had */
  private land: { generation: number; z: number; view: Box; want: Set<string>; own: Set<string>; missing: number; failed: number } | null = null
  /** the land tiles being fetched and decoded: a tile wanted again meanwhile joins the load under way */
  private readonly landLoads = new Map<string, Promise<void>>()
  /** when the tiles fetched ahead were asked, within the last minute */
  private aheadAt: number[] = []
  private cloud: { key: string; generation: number; source: CloudSource; timeMs: number } | null = null
  /** the satellite and hour of the clouds' detail on show */
  private cloudShown: { source: CloudSource; timeMs: number } | null = null
  private generation = 0
  /** tile pictures held, oldest first */
  private readonly held = new Map<string, Held>()
  private heldBytes = 0
  private readonly retryAt = new Map<string, number>()
  private retryTimer: number | null = null
  private readonly asking = new Map<string, { promise: Promise<Held | null>; ask: Ask | null }>()
  private readonly queue: Ask[] = []
  private inFlight = 0
  private worker: Worker | null | undefined
  private nextJob = 1
  private readonly jobs = new Map<number, (b: Built) => void>()
  private building = false
  private buildAgain: (() => void) | null = null
  private status: DetailStatus = { photo: false, surface: "off", clouds: null }
  private redrawQueued = false
  private disposed = false

  constructor(private readonly gl: GlobeGl, private readonly api: TileApi | null, private readonly redraw: () => void, private readonly onStatus?: (s: DetailStatus) => void) {}

  /** The view now (called with every frame drawn): the land is planned as it moves, the clouds once it stands still. */
  view(cam: GlobeCamera, frame: Frame): void {
    const c = this.cam, f = this.frame
    if (c && f && c.lon === cam.lon && c.lat === cam.lat && c.zoom === cam.zoom && f.w === frame.w && f.h === frame.h && f.r === frame.r) return
    this.cam = { ...cam }
    this.frame = { ...frame }
    const now = performance.now()
    this.movedAt = now
    if (this.timer == null) this.timer = window.setTimeout(this.stilled, STILL_MS)
    if (this.landTimer == null) this.landTimer = window.setTimeout(this.landDue, Math.max(0, this.landPlannedAt + MOVING_PLAN_MS - now))
  }

  /** The hour of the world's cloud image (the clouds' detail is of the same hour); null = no image, no detail. */
  setHour(ms: number | null): void {
    if (ms === this.hourMs) return
    this.hourMs = ms
    this.planClouds()
  }

  /** whether the clouds show (no cloud tiles are asked while they do not) */
  setClouds(on: boolean): void {
    if (on === this.cloudsOn) return
    this.cloudsOn = on
    this.planClouds()
  }

  /** NASA's picture of the whole world is on show, or terminally unreadable for this load. */
  photoShown(): void { this.setStatus({ photo: true, photoError: null }) }
  photoFailed(why: string): void { this.setStatus({ photo: false, photoError: why }) }

  dispose(): void {
    this.disposed = true
    for (const t of [this.timer, this.landTimer, this.retryTimer]) if (t != null) window.clearTimeout(t)
    for (const a of this.queue) a.go(null)
    this.queue.length = 0
    this.worker?.terminate()
    this.held.clear()
  }

  private readonly stilled = (): void => {
    this.timer = null
    const quiet = performance.now() - this.movedAt
    if (quiet < STILL_MS) { this.timer = window.setTimeout(this.stilled, STILL_MS - quiet); return }
    this.planClouds()
    if (this.land?.missing === 0) this.fetchAhead()
  }

  private readonly landDue = (): void => {
    this.landTimer = null
    this.landPlannedAt = performance.now()
    this.planLand()
  }

  private setStatus(s: Partial<DetailStatus>): void {
    const next = { ...this.status, ...s }
    if ((Object.keys(s) as Array<keyof DetailStatus>).every((k) => next[k] === this.status[k])) return
    this.status = next
    this.onStatus?.(this.status)
  }

  /** One frame for however many tiles came in since the last. */
  private queueRedraw(): void {
    if (this.redrawQueued || this.disposed) return
    this.redrawQueued = true
    requestAnimationFrame(() => { this.redrawQueued = false; if (!this.disposed) this.redraw() })
  }

  /** the view's degrees a device pixel, and its box when sharper pictures are worth asking for there */
  private viewNow(): { degPerPx: number; box: Box; cam: GlobeCamera } | null {
    const cam = this.cam, f = this.frame
    if (this.disposed || !this.api || !cam || !f) return null
    const degPerPx = 1 / (f.r * RAD)
    const box = degPerPx < WORLD_DEG_PER_PX / LEVEL_SLACK ? visibleBox(cam, f) : null
    return box ? { degPerPx, box, cam } : null
  }

  // ---- the land ----

  private planLand(): void {
    const v = this.viewNow()
    const generation = ++this.generation
    if (!v) { this.land = null; this.setStatus({ surface: "off", surfaceError: null }); return }
    // the finest level the screen needs anywhere in the view — where it is nearest the equator, a degree of longitude is
    // widest on screen — coarser where its tiles and the coarser ones under them would crowd the cache
    const room = Math.max(8, Math.floor(this.gl.surfaceLayers * VIEW_SHARE))
    const nearEquator = v.box.south <= 0 && v.box.north >= 0 ? 0 : Math.min(Math.abs(v.box.south), Math.abs(v.box.north))
    let z = levelFor(v.degPerPx / Math.max(0.05, Math.cos(nearEquator * RAD)), SURFACE_MIN_LEVEL, SURFACE_MAX_LEVEL)
    let want: SurfaceReq[] = [], own: SurfaceReq[] = []
    for (;; z--) {
      // the coarser levels under the view first (a few tiles: something sharp at once), then its own, middle out
      const plan = tilePlan(v.box, z, room)
      want = []
      own = plan ? planTiles(plan).map((t): SurfaceReq => ({ kind: "surface", z, row: t.row, col: t.col })) : []
      for (let zc = Math.max(SURFACE_MIN_LEVEL, z - 2); plan && zc < z; zc++) {
        const p = tilePlan(v.box, zc, room)
        if (p) for (const t of planTiles(p)) want.push({ kind: "surface", z: zc, row: t.row, col: t.col })
      }
      want.push(...own)
      if ((plan && want.length <= room) || z <= SURFACE_MIN_LEVEL) break
    }
    if (own.length === 0 || want.length > room) { this.land = null; this.setStatus({ surface: "off", surfaceError: null }); return }
    // what the view wants stays in the cache: anything else goes first when room is needed
    this.gl.keepSurfaceTiles(want)
    const land = { generation, z, view: v.box, want: new Set(want.map(reqKey)), own: new Set(own.map(reqKey)), missing: 0, failed: 0 }
    this.land = land
    for (const req of want) {
      if (this.gl.hasSurfaceTile(req.z, req.row, req.col)) continue
      if (req.z === z) land.missing++
      void this.loadLandTile(req, generation)
    }
    this.landStatus()
    if (land.missing === 0) this.fetchAhead()
  }

  /** A land tile fetched, decoded and put in the cache — once, however often it is wanted meanwhile. */
  private loadLandTile(req: SurfaceReq, generation: number): Promise<void> {
    const k = reqKey(req)
    const running = this.landLoads.get(k)
    // under way already: the newer round takes over its ask (so it is not dropped as an older round's)
    if (running) { void this.fetch(req, generation); return running }
    const load = this.loadLandTileOnce(req, generation).finally(() => this.landLoads.delete(k))
    this.landLoads.set(k, load)
    return load
  }

  private async loadLandTileOnce(req: SurfaceReq, generation: number): Promise<void> {
    const h = await this.fetch(req, generation)
    const own = this.land?.own.has(reqKey(req)) === true
    if (!h) { if (own && this.land) { this.land.failed++; this.landStatus() } return }
    if (this.disposed || this.gl.hasSurfaceTile(req.z, req.row, req.col)) return
    const img = await createImageBitmap(new Blob([h.bytes as BlobPart], { type: "image/jpeg" })).catch(() => null)
    if (!img) { if (own && this.land) { this.land.failed++; this.landStatus("a surface tile could not be decoded; the world picture fills its place") } return }
    // a tile of a view already left is kept all the same (it may well be wanted again), never in place of the view's own
    if (!this.disposed && !this.gl.hasSurfaceTile(req.z, req.row, req.col) && this.gl.putSurfaceTile(req.z, req.row, req.col, img, this.land?.want.has(reqKey(req)) === true)) {
      this.queueRedraw()
      const land = this.land
      if (land && land.own.has(reqKey(req)) && --land.missing === 0) this.fetchAhead()
      this.landStatus()
    }
    img.close()
  }

  private landStatus(error?: string): void {
    const land = this.land
    if (!land) return
    const size = land.own.size
    if (land.missing === 0 || land.missing < size) this.setStatus({ surface: "sharp", surfaceError: error ?? null })
    else if (land.failed >= size) this.setStatus({ surface: "failed", surfaceError: error ?? "no surface tiles available" })
    else this.setStatus({ surface: "loading", surfaceError: error ?? null })
  }

  /** The next level's tiles for the middle of the view, into the GPU cache, while nothing else is asked — so zooming
   *  in finds them at hand — within a few a minute, to stay a polite client. */
  private fetchAhead(): void {
    const land = this.land
    if (this.disposed || !land || land.z >= SURFACE_MAX_LEVEL || this.queue.length > 0 || this.inFlight > 0) return
    const now = performance.now()
    // only once the view stands still (not for views passed on the way), and while the minute's requests allow
    if (now - this.movedAt < STILL_MS || (this.api?.usage?.() ?? 0) > AHEAD_MAX_USAGE) return
    this.aheadAt = this.aheadAt.filter((t) => now - t < 60_000)
    let budget = Math.min(AHEAD_MAX, AHEAD_PER_MIN - this.aheadAt.length)
    const finer = budget > 0 ? tilePlan(middleOf(land.view, AHEAD_SHARE), land.z + 1, 64) : null
    if (!finer) return
    for (const t of planTiles(finer)) {
      if (budget <= 0) break
      if (this.gl.hasSurfaceTile(finer.z, t.row, t.col)) continue
      budget--
      this.aheadAt.push(now)
      void this.loadLandTile({ kind: "surface", z: finer.z, row: t.row, col: t.col }, land.generation)
    }
  }

  // ---- the clouds ----

  private dropClouds(): void {
    if (!this.cloud && !this.cloudShown && !this.status.clouds) return
    this.cloud = null
    this.cloudShown = null
    this.gl.setCloudDetail(null)
    this.setStatus({ clouds: null })
    this.queueRedraw()
  }

  private planClouds(): void {
    const v = this.viewNow()
    if (!v) { this.dropClouds(); return }
    const fits = Math.max(1, this.gl.maxSharpTiles)
    // the satellite overhead, at the world image's hour
    const src = this.cloudsOn && this.hourMs != null ? bestSource(v.cam.lat, v.cam.lon) : null
    let cp: TilePlan | null = null
    if (src) {
      let zc = levelFor(v.degPerPx, CLOUD_MIN_LEVEL, CLOUD_SOURCES[src].maxLevel)
      cp = tilePlan(v.box, zc, Math.min(MAX_SIDE_CLOUDS, fits))
      while (!cp && zc > CLOUD_MIN_LEVEL) cp = tilePlan(v.box, --zc, Math.min(MAX_SIDE_CLOUDS, fits))
    }
    if (!src || !cp || this.hourMs == null) { this.dropClouds(); return }
    const key = `${src}|${this.hourMs}|${planKey(cp)}`
    if (key !== this.cloud?.key) this.loadClouds(src, this.hourMs, cp, key)
  }

  private loadClouds(src: CloudSource, timeMs: number, plan: TilePlan, key: string): void {
    const generation = ++this.generation
    this.cloud = { key, generation, source: src, timeMs }
    // another hour: what is on show is not of it, so it goes at once (another satellite's picture of the same hour shows
    // the same clouds, and stays until this one is built)
    if (this.cloudShown && this.cloudShown.timeMs !== timeMs) {
      this.cloudShown = null
      this.gl.setCloudDetail(null)
      this.queueRedraw()
    }
    const mine = () => this.cloud?.generation === generation && !this.disposed
    const tiles = planTiles(plan)
    // by day there, the visible band too
    const mid = middleOf(plan.box, 0)
    const visible = sunCosAt((mid.south + mid.north) / 2, (mid.west + mid.east) / 2, subsolarPoint(timeMs)) > VIS_SUN_COS
    const got: Got[] = [], gotVis: Got[] = []
    const total = tiles.length * (visible ? 2 : 1)
    let done = 0, pending: number | null = null
    const status = (have: number, fromMs: number, toMs: number, error?: string, vis = false) =>
      this.setStatus({ clouds: { source: src, fromMs, toMs, z: plan.z, have, want: tiles.length, done: done === total, visible: vis, error } })
    status(0, timeMs, timeMs)
    const startedAt = performance.now()
    const build = () => {
      pending = null
      if (!mine()) return
      if (got.length === 0 && gotVis.length === 0) { status(0, timeMs, timeMs); return }
      // while an earlier detail is on show, a part-built one would leave holes in it: it waits a moment for the rest
      if (done < total && this.cloudShown && performance.now() - startedAt < CLOUD_SHOW_WITHIN_MS) { pending = window.setTimeout(build, REBUILD_MS); return }
      const parts = [...got], visParts = [...gotVis], times = [...parts, ...visParts].map((p) => p.timeMs)
      this.build({
        w: plan.cols * TILE_PX, h: plan.rows * TILE_PX, blurPx: blurRadius(plan.z), timeMs,
        area: { west: plan.box.west, north: plan.box.north, res: tileRes(plan.z), subLon: CLOUD_SOURCES[src].subLon },
        tiles: parts.map(({ x, y, key: k, bytes }) => ({ x, y, key: k, bytes })),
        vis: visParts.map(({ x, y, key: k, bytes }) => ({ x, y, key: k, bytes })),
      }, (b) => {
        if (!mine()) return
        if (b.error || !b.px) { status(0, timeMs, timeMs, b.error ?? "cloud detail decode failed"); return }
        this.gl.setCloudDetail({ key, box: plan.box, w: plan.cols * TILE_PX, h: plan.rows * TILE_PX, px: b.px })
        this.cloudShown = { source: src, timeMs }
        status(b.seen ?? 0, Math.min(...times), Math.max(...times), b.failed ? `${b.failed} of ${parts.length + visParts.length} fetched tiles could not be decoded` : undefined, visParts.length > 0)
        this.queueRedraw()
      })
    }
    const ask = (t: { i: number; j: number; row: number; col: number }, band: "vis" | undefined, into: Got[]) => {
      const req: TileReq = band ? { kind: "clouds", source: src, timeMs, z: plan.z, row: t.row, col: t.col, band } : { kind: "clouds", source: src, timeMs, z: plan.z, row: t.row, col: t.col }
      void this.fetch(req, generation).then((h) => {
        if (h && mine()) into.push({ x: t.i * TILE_PX, y: t.j * TILE_PX, key: reqKey(req), bytes: h.bytes, timeMs: h.timeMs ?? timeMs })
      }).finally(() => {
        if (!mine()) return
        if (++done === total) { if (pending != null) window.clearTimeout(pending); build() }
        else if (pending == null) pending = window.setTimeout(build, REBUILD_MS)
      })
    }
    for (const t of tiles) {
      ask(t, undefined, got)
      if (visible) ask(t, "vis", gotVis)
    }
  }

  /** One build at a time; a newer one waiting replaces the one before it. */
  private build(job: Omit<WorkerJob, "id">, done: (b: Built) => void): void {
    const run = () => {
      this.building = true
      void this.inWorker(job).then(done).finally(() => {
        this.building = false
        const next = this.buildAgain
        this.buildAgain = null
        next?.()
      })
    }
    if (this.building) this.buildAgain = run
    else run()
  }

  private inWorker(job: Omit<WorkerJob, "id">): Promise<Built> {
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL("./detailWorker.ts", import.meta.url), { type: "module" })
        this.worker.onmessage = (ev: MessageEvent<Built>) => { const go = this.jobs.get(ev.data?.id); if (go) { this.jobs.delete(ev.data.id); go(ev.data) } }
        // a broken worker: the clouds keep the world image's detail
        const broken = () => {
          for (const go of this.jobs.values()) go({ id: 0, error: "the worker failed" })
          this.jobs.clear()
          this.worker?.terminate()
          this.worker = null
        }
        this.worker.onerror = broken
        this.worker.onmessageerror = broken
      } catch { this.worker = null }
    }
    const w = this.worker
    if (!w) return Promise.resolve({ id: 0, error: "no worker" })
    const id = this.nextJob++
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { if (this.jobs.delete(id)) resolve({ id, error: "the build took too long" }) }, BUILD_TIMEOUT_MS)
      this.jobs.set(id, (b) => { window.clearTimeout(timer); resolve(b) })
      // copies go to the worker: the window keeps its own for the next build
      const tiles = job.tiles.map((t) => ({ ...t, bytes: t.bytes.slice() })), vis = job.vis.map((t) => ({ ...t, bytes: t.bytes.slice() }))
      w.postMessage({ ...job, id, tiles, vis } satisfies WorkerJob, [...tiles, ...vis].map((t) => t.bytes.buffer))
    })
  }

  // ---- the tiles ----

  /** A tile's picture for a load: held, or asked of the tile fetcher; null when there is none now. */
  private fetch(req: TileReq, generation: number): Promise<Held | null> {
    const k = reqKey(req)
    const held = this.held.get(k)
    if (held) { this.held.delete(k); this.held.set(k, held); return Promise.resolve(held) }
    const retry = this.retryAt.get(k)
    if (retry != null && retry > Date.now()) return Promise.resolve(null)
    const running = this.asking.get(k)
    if (running) {
      // still waiting to go: the current load takes it over
      if (running.ask) running.ask.generation = generation
      return running.promise
    }
    const entry: { promise: Promise<Held | null>; ask: Ask | null } = { promise: Promise.resolve(null), ask: null }
    entry.promise = new Promise<Held | null>((go) => {
      entry.ask = { req, generation, go }
      this.queue.push(entry.ask)
    }).finally(() => this.asking.delete(k))
    this.asking.set(k, entry)
    this.pump()
    return entry.promise
  }

  /** Sends queued asks while fewer than MAX_ASKING are out, in the order asked; an ask of a round no longer current is
   *  dropped without being sent. */
  private pump(): void {
    if (this.disposed) return
    while (this.inFlight < MAX_ASKING && this.queue.length) {
      const ask = this.queue.shift()!
      const entry = this.asking.get(reqKey(ask.req))
      if (entry) entry.ask = null
      if (ask.generation !== this.land?.generation && ask.generation !== this.cloud?.generation) { ask.go(null); continue }
      this.inFlight++
      void this.api!.tile(ask.req).catch((): TileAnswer => ({ none: "failed" })).then((a) => {
        const k = reqKey(ask.req)
        if ("bytes" in a) {
          const prev = this.held.get(k)
          if (prev) this.heldBytes -= prev.bytes.length
          this.held.delete(k)
          this.held.set(k, { bytes: a.bytes, timeMs: a.timeMs })
          this.heldBytes += a.bytes.length
          for (const [old, h] of this.held) { if (this.heldBytes <= HELD_BYTES) break; this.held.delete(old); this.heldBytes -= h.bytes.length }
          ask.go({ bytes: a.bytes, timeMs: a.timeMs })
          return
        }
        this.retryAt.set(k, Date.now() + (a.none === "missing" ? 3600_000 : a.none === "busy" ? BUSY_RETRY_MS : RETRY_MS))
        ask.go(null)
        if (a.none !== "missing") this.retrySoon(a.none === "busy" ? BUSY_RETRY_MS : RETRY_MS)
      }).finally(() => {
        this.inFlight--
        this.pump()
        // the network gone idle with the view's land in: the next level ahead
        if (this.inFlight === 0 && this.queue.length === 0 && this.land?.missing === 0) this.fetchAhead()
      })
    }
  }

  /** A tile could not be had now: the view is planned again once it may be asked again (even if it stands still). */
  private retrySoon(afterMs: number): void {
    if (this.retryTimer != null || this.disposed) return
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      const now = Date.now()
      for (const [k, t] of this.retryAt) if (t <= now) this.retryAt.delete(k)
      // the same plans load again: what is held comes at once, what failed is asked again
      if (this.cloud) this.cloud = { ...this.cloud, key: "" }
      this.planLand()
      this.planClouds()
    }, afterMs + 1000)
  }
}

export interface WorkerJob {
  id: number
  w: number
  h: number
  blurPx: number
  /** the hour of the pictures (the visible band is weighed by the sun's height then) */
  timeMs: number
  area: { west: number; north: number; res: number; subLon: number }
  tiles: Array<{ x: number; y: number; key: string; bytes: Uint8Array }>
  /** the visible band's tiles, by day */
  vis: Array<{ x: number; y: number; key: string; bytes: Uint8Array }>
}
