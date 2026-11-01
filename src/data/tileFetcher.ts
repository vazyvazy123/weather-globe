// The globe's sharp pictures, fetched by the browser straight from NASA GIBS (which answers cross-origin requests):
//  - the surface: NASA's Blue Marble Next Generation (a cloud-free composite of the land, ~500 m a pixel) — the whole
//    world once at 4096 × 2048 from GIBS's map service (and its shaded relief and bathymetry, for the sea's colour), and the 512-px tiles of the part in view when the globe is
//    zoomed in. The picture never changes, so each is kept in Cache Storage (the most recent SURFACE_KEEP tiles) and
//    fetched once;
//  - the clouds' fine structure: the clean longwave infrared (band 13, ~2 km) of the geostationary satellite overhead
//    (GOES-West, GOES-East or Himawari) at the time of the world's cloud image, and by day its red visible band (~1 km):
//    the clouds as a camera sees them. A time the service lacks is taken from
//    10 min either side, and the answer says which picture it is. Cloud tiles are held in memory only (detail.ts).
// A request names a tile (geo/tiles.ts: level, row, column, satellite, time), never an address, and anything off the
// grid is refused. Requests are capped (at most 6 at once and a few hundred a minute), a tile is asked once at a time,
// and a tile the service does not have is not asked again for an hour.
import { CLOUD_SOURCES, CLOUD_STEP_MS, checkTileReq, type CloudSource, type TileAnswer, type TileReq } from "../geo/tiles"
import { Lane, cachedBytes, getBytes, keepBytes, trimCache } from "./throttle"

export const GIBS_WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"
export const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
export const SURFACE_LAYER = "BlueMarble_NextGeneration"
/** the sea floor's relief, for the sea's colour */
export const BATHY_LAYER = "BlueMarble_ShadedRelief_Bathymetry"
/** the whole world's surface picture */
export const BASE_SIZE = { w: 4096, h: 2048 } as const
const TIMEOUT_MS = 30_000
const BASE_TIMEOUT_MS = 90_000
const MISSING_FOR_MS = 3600_000
const CACHE_NAME = "weather-globe-surface-v1"
/** surface tiles kept in Cache Storage (~50 kB each) */
const SURFACE_KEEP = 2000
/** the cache is trimmed after this many new tiles */
const TRIM_EVERY = 100
const MAX_AT_ONCE = 6
const MAX_PER_MINUTE = 300
/** a time the service lacks is taken from this near it, nearest first */
const CLOUD_TRIES: readonly number[] = [0, -CLOUD_STEP_MS, CLOUD_STEP_MS]

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z")

/** Blue Marble's tile (NASA GIBS's tile service). */
export const surfaceTileUrl = (z: number, row: number, col: number): string =>
  `${GIBS_WMTS}/${SURFACE_LAYER}/default/500m/${z}/${row}/${col}.jpeg`

/** Blue Marble's whole world (NASA GIBS's map service), or another layer's. */
export function baseUrl(layer = SURFACE_LAYER): string {
  const q = new URLSearchParams({ SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0", CRS: "EPSG:4326", STYLES: "", LAYERS: layer,
    BBOX: "-90,-180,90,180", WIDTH: String(BASE_SIZE.w), HEIGHT: String(BASE_SIZE.h), FORMAT: "image/jpeg" })
  return `${GIBS_WMS}?${q.toString()}`
}

/** A satellite's infrared (or visible) tile at a time (NASA GIBS's tile service). */
export const cloudTileUrl = (source: CloudSource, timeMs: number, z: number, row: number, col: number, band?: "vis"): string =>
  band === "vis"
    ? `${GIBS_WMTS}/${CLOUD_SOURCES[source].visLayer}/default/${iso(timeMs)}/1km/${z}/${row}/${col}.png`
    : `${GIBS_WMTS}/${CLOUD_SOURCES[source].layer}/default/${iso(timeMs)}/2km/${z}/${row}/${col}.png`

export const isJpeg = (b: Uint8Array): boolean => b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
export const isPng = (b: Uint8Array): boolean => b.length > 60 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

type Get = (url: string, timeoutMs: number) => Promise<{ status: number; bytes: Uint8Array }>

export class TileFetcher {
  private readonly inFlight = new Map<string, Promise<TileAnswer>>()
  /** tiles the service answered it does not have → when to ask again */
  private readonly missing = new Map<string, number>()
  private readonly lane: Lane
  /** the whole-world pictures being fetched or fetched, by layer */
  private readonly worldRuns = new Map<string, Promise<Uint8Array | null>>()
  private newTiles = 0

  constructor(private readonly opts: { get?: Get; now?: () => number; cache?: boolean } = {}) {
    this.lane = new Lane(MAX_AT_ONCE, MAX_PER_MINUTE, () => this.now)
  }

  private get now(): number { return (this.opts.now ?? Date.now)() }
  private get useCache(): boolean { return this.opts.cache !== false }

  private fetchBytes(url: string, timeoutMs: number): Promise<{ status: number; bytes: Uint8Array }> {
    return (this.opts.get ?? ((u, t) => getBytes(u, t, "image/*")))(url, timeoutMs)
  }

  /** Blue Marble's whole world (JPEG, 4096 × 2048): from the cache, or fetched once; null when it cannot be had now. */
  base(): Promise<Uint8Array | null> { return this.world(SURFACE_LAYER) }

  /** Its shaded relief and bathymetry, the same way. */
  bathymetry(): Promise<Uint8Array | null> { return this.world(BATHY_LAYER) }

  /** the share of this minute's requests already made (0..1) */
  usage(): number { return this.lane.usage() }

  private world(layer: string): Promise<Uint8Array | null> {
    const running = this.worldRuns.get(layer)
    if (running) return running
    const url = baseUrl(layer)
    const run = (async () => {
      const held = this.useCache ? await cachedBytes(CACHE_NAME, url) : null
      if (held && isJpeg(held)) return held
      const r = await this.lane.run(() => this.fetchBytes(url, BASE_TIMEOUT_MS))
      if (r === "refused" || r.status !== 200 || !isJpeg(r.bytes)) return null
      if (this.useCache) await keepBytes(CACHE_NAME, url, r.bytes, "image/jpeg")
      return r.bytes
    })().catch(() => null).then((b) => { if (!b) this.worldRuns.delete(layer); return b })
    this.worldRuns.set(layer, run)
    return run
  }

  /** One tile (checked first). */
  tile(v: unknown): Promise<TileAnswer> {
    const req = checkTileReq(v, this.now)
    if (!req) return Promise.resolve({ none: "missing" })
    const key = keyOf(req)
    const until = this.missing.get(key)
    if (until != null && until > this.now) return Promise.resolve({ none: "missing" })
    const running = this.inFlight.get(key)
    if (running) return running
    const run = this.fetchTile(req, key).catch((): TileAnswer => ({ none: "failed" })).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, run)
    return run
  }

  private async fetchTile(req: TileReq, key: string): Promise<TileAnswer> {
    if (req.kind === "surface") {
      const url = surfaceTileUrl(req.z, req.row, req.col)
      const held = this.useCache ? await cachedBytes(CACHE_NAME, url) : null
      if (held && isJpeg(held)) return { bytes: held }
      const r = await this.lane.run(() => this.fetchBytes(url, TIMEOUT_MS))
      if (r === "refused") return { none: "busy" }
      if (r.status === 404 || (r.status === 200 && !isJpeg(r.bytes))) { this.missing.set(key, this.now + MISSING_FOR_MS); return { none: "missing" } }
      if (r.status !== 200) return { none: "failed" }
      if (this.useCache) {
        await keepBytes(CACHE_NAME, url, r.bytes, "image/jpeg")
        if (++this.newTiles % TRIM_EVERY === 0) void trimCache(CACHE_NAME, SURFACE_KEEP)
      }
      return { bytes: r.bytes }
    }
    for (const dt of CLOUD_TRIES) {
      const r = await this.lane.run(() => this.fetchBytes(cloudTileUrl(req.source, req.timeMs + dt, req.z, req.row, req.col, req.band), TIMEOUT_MS))
      if (r === "refused") return { none: "busy" }
      // a missing time: the service answers 404 or 400
      if (r.status === 404 || r.status === 400 || (r.status === 200 && !isPng(r.bytes))) continue
      if (r.status !== 200) return { none: "failed" }
      return { bytes: r.bytes, timeMs: req.timeMs + dt }
    }
    this.missing.set(key, this.now + MISSING_FOR_MS)
    return { none: "missing" }
  }
}

const keyOf = (req: TileReq): string =>
  req.kind === "surface" ? `s/${req.z}/${req.row}/${req.col}` : `c/${req.source}${req.band === "vis" ? "/vis" : ""}/${req.timeMs}/${req.z}/${req.row}/${req.col}`
