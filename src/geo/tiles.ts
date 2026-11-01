// The tile grid of the globe's sharp pictures — NASA GIBS's geographic grid (EPSG:4326): 512-px tiles from 180°W, 90°N,
// a level-z tile spanning 288 / 2^z degrees — the geostationary satellites whose infrared sharpens the clouds, and the
// one request shape the detail loader may ask the tile fetcher for (data/tileFetcher.ts builds the address).

export const TILE_PX = 512
/** a level-z tile's span (degrees) */
export const tileSpan = (z: number): number => 288 / 2 ** z
/** degrees per pixel at level z */
export const tileRes = (z: number): number => tileSpan(z) / TILE_PX
/** a level's columns round the world and rows from pole to pole (whole tiles from level 3 on) */
export const tileCols = (z: number): number => Math.round(360 / tileSpan(z))
export const tileRows = (z: number): number => Math.round(180 / tileSpan(z))

/** the surface picture's levels worth asking for: 4 (~4 km a pixel, finer than the whole-world picture) to 7 (~500 m,
 *  the picture's own resolution) */
export const SURFACE_MIN_LEVEL = 4
export const SURFACE_MAX_LEVEL = 7
/** the cloud tiles' coarsest level (finer than the world's cloud image) */
export const CLOUD_MIN_LEVEL = 4

export type CloudSource = "goes-west" | "goes-east" | "himawari"
export interface CloudSourceInfo {
  /** the satellite, for the caption */
  name: string
  /** who operates it */
  by: string
  /** the NASA GIBS layer of its clean longwave infrared window band (band 13, 10.3 µm) */
  layer: string
  /** the longitude it stands over (°) */
  subLon: number
  /** its finest level (its own resolution) */
  maxLevel: number
  /** the NASA GIBS layer of its red visible band (~1 km): the clouds as a camera sees them, by day */
  visLayer: string
}
export const CLOUD_SOURCES: Readonly<Record<CloudSource, CloudSourceInfo>> = {
  "goes-west": { name: "GOES-West", by: "NOAA", layer: "GOES-West_ABI_Band13_Clean_Infrared", subLon: -137.2, maxLevel: 5, visLayer: "GOES-West_ABI_Band2_Red_Visible_1km" },
  "goes-east": { name: "GOES-East", by: "NOAA", layer: "GOES-East_ABI_Band13_Clean_Infrared", subLon: -75.2, maxLevel: 5, visLayer: "GOES-East_ABI_Band2_Red_Visible_1km" },
  himawari: { name: "Himawari", by: "JMA", layer: "Himawari_AHI_Band13_Clean_Infrared", subLon: 140.7, maxLevel: 5, visLayer: "Himawari_AHI_Band3_Red_Visible_1km" },
}
/** the cloud tiles' times: on the 10-minute mark, at most a day old */
export const CLOUD_STEP_MS = 10 * 60_000
export const CLOUD_MAX_AGE_MS = 24 * 3600_000

export type TileReq =
  | { kind: "surface"; z: number; row: number; col: number }
  | { kind: "clouds"; source: CloudSource; timeMs: number; z: number; row: number; col: number; band?: "vis" }
/** a tile's picture (JPEG for the surface; PNG for the clouds, with the time of the picture it is — up to 10 min from the
 *  time asked), or why there is none: the service has no such picture ("missing"), it could not be read now ("failed":
 *  worth asking again later), or this minute's requests are spent ("busy": worth asking again in a moment) */
export type TileAnswer = { bytes: Uint8Array; timeMs?: number } | { none: "missing" | "failed" | "busy" }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

/** A request, checked: a tile on the grid at a level worth asking for, a listed satellite, a time on the 10-minute mark
 *  within the last day (a minute's slack for the clock); anything else is null. */
export function checkTileReq(v: unknown, nowMs: number): TileReq | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const { z, row, col } = o
  if (!isInt(z) || !isInt(row) || !isInt(col)) return null
  const onGrid = row >= 0 && row < tileRows(z) && col >= 0 && col < tileCols(z)
  if (o.kind === "surface") return z >= SURFACE_MIN_LEVEL && z <= SURFACE_MAX_LEVEL && onGrid ? { kind: "surface", z, row, col } : null
  if (o.kind !== "clouds" || typeof o.source !== "string" || !Object.prototype.hasOwnProperty.call(CLOUD_SOURCES, o.source)) return null
  const source = o.source as CloudSource, t = o.timeMs
  if (z < CLOUD_MIN_LEVEL || z > CLOUD_SOURCES[source].maxLevel || !onGrid) return null
  if (!isInt(t) || t % CLOUD_STEP_MS !== 0 || t > nowMs + 60_000 || t < nowMs - CLOUD_MAX_AGE_MS) return null
  if (o.band != null && o.band !== "vis") return null
  return o.band === "vis" ? { kind: "clouds", source, timeMs: t, z, row, col, band: "vis" } : { kind: "clouds", source, timeMs: t, z, row, col }
}
