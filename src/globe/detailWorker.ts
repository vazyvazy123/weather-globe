// The globe's sharp clouds, built off the main thread (detail.ts): a satellite's infrared tiles decoded into
// temperatures and laid side by side, then turned into the clouds' fine structure (irDecode.ts); by day its visible tiles
// too, turned into the clouds as a camera sees them (visDecode.ts). Each tile is decoded once and remembered while it
// may be asked again (a tile that would not decode is tried again next time). The answer — four bytes a texel: the
// infrared's fine structure and trust, the visible cloud and its trust — says how many tiles had something to read.
import { NO_TEMP, cloudDetail, gibsReader, tileTemps } from "./irDecode"
import { visibleClouds } from "./visDecode"
import type { WorkerJob } from "./detail"
import { TILE_PX } from "../geo/tiles"

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerJob>) => void) | null
  postMessage(msg: unknown, transfer: Transferable[]): void
}
/** decoded tiles, oldest first, and whether each had anything seen in it */
const decoded = new Map<string, { temps: Int16Array; seen: boolean }>()
const decodedVis = new Map<string, { gray: Uint8Array; alpha: Uint8Array }>()
const KEEP_TILES = 72
/** a tile counts as seen when something is read in at least this share of it (sampled every SAMPLE_STEP pixels) */
const SEEN_SHARE = 0.01
const SAMPLE_STEP = 97
const read = gibsReader()

async function pixels(bytes: Uint8Array): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
  const c = new OffscreenCanvas(TILE_PX, TILE_PX)
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("no 2D canvas in the worker")
  ctx.drawImage(bmp, 0, 0, TILE_PX, TILE_PX)
  bmp.close()
  return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data
}

async function decode(bytes: Uint8Array): Promise<{ temps: Int16Array; seen: boolean }> {
  const { temps } = tileTemps(await pixels(bytes), TILE_PX, TILE_PX, read)
  let n = 0
  for (let k = 0; k < temps.length; k += SAMPLE_STEP) if (temps[k] !== NO_TEMP) n++
  return { temps, seen: n * SAMPLE_STEP >= temps.length * SEEN_SHARE }
}

/** a visible tile: its brightness and coverage */
async function decodeVis(bytes: Uint8Array): Promise<{ gray: Uint8Array; alpha: Uint8Array }> {
  const px = await pixels(bytes)
  const gray = new Uint8Array(TILE_PX * TILE_PX), alpha = new Uint8Array(TILE_PX * TILE_PX)
  for (let k = 0; k < gray.length; k++) { gray[k] = px[4 * k]; alpha[k] = px[4 * k + 3] }
  return { gray, alpha }
}

/** a decoded tile kept, newest last */
function remember<T>(m: Map<string, T>, key: string, v: T): void {
  m.delete(key)
  m.set(key, v)
  while (m.size > KEEP_TILES) m.delete(m.keys().next().value as string)
}

scope.onmessage = (ev) => {
  const job = ev.data
  void (async () => {
    const n = job.w * job.h
    const temps = new Int16Array(n).fill(NO_TEMP)
    let seen = 0, failed = 0
    for (const t of job.tiles) {
      const d = decoded.get(t.key) ?? await decode(t.bytes).catch(() => undefined)
      if (!d) { failed++; continue }
      remember(decoded, t.key, d)
      if (d.seen) seen++
      for (let y = 0; y < TILE_PX; y++) temps.set(d.temps.subarray(y * TILE_PX, (y + 1) * TILE_PX), (t.y + y) * job.w + t.x)
    }
    const rg = cloudDetail(temps, job.w, job.h, job.blurPx, job.area)
    // by day, the visible picture of the same hour
    const gray = new Uint8Array(n), alpha = new Uint8Array(n)
    let anyVis = false
    for (const t of job.vis) {
      const d = decodedVis.get(t.key) ?? await decodeVis(t.bytes).catch(() => undefined)
      if (!d) { failed++; continue }
      remember(decodedVis, t.key, d)
      anyVis = true
      for (let y = 0; y < TILE_PX; y++) {
        gray.set(d.gray.subarray(y * TILE_PX, (y + 1) * TILE_PX), (t.y + y) * job.w + t.x)
        alpha.set(d.alpha.subarray(y * TILE_PX, (y + 1) * TILE_PX), (t.y + y) * job.w + t.x)
      }
    }
    const vis = anyVis ? visibleClouds(gray, alpha, job.w, job.h, { west: job.area.west, north: job.area.north, res: job.area.res, timeMs: job.timeMs }) : null
    const px = new Uint8Array(4 * n)
    for (let k = 0; k < n; k++) {
      px[4 * k] = rg[2 * k]
      px[4 * k + 1] = rg[2 * k + 1]
      if (vis) { px[4 * k + 2] = vis.cloud[k]; px[4 * k + 3] = vis.trust[k] }
    }
    scope.postMessage({ id: job.id, px, seen, failed }, [px.buffer])
  })().catch((err: unknown) => scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : "build failed" }, []))
}
