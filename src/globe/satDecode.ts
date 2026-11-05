// The satellite image (a PNG) to its cloud field. It runs only in satWorker.ts, off the window's main thread. Decoded as
// the image holds it (no colour management, alpha not premultiplied), so the brightness thresholds read the mosaic's own
// values.
import { satCloudField } from "./satClouds"

export interface SatJob { png: Uint8Array; latTop: number; latBottom: number }
export type SatResult =
  | { ok: true; field: Uint8Array; w: number; h: number; coverage: number }
  | { ok: false; why: string }

/** an image covering less of the world than this is not used */
export const MIN_COVERAGE = 0.5
/** an image larger than this (the mosaic asked for is 4096 × 1638) is not decoded: it is not the mosaic */
const MAX_PIXELS = 4096 * 2048

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's width and height from its header (IHDR, always first), before anything is decoded; null if not a PNG. */
export function pngSize(png: Uint8Array): { w: number; h: number } | null {
  if (png.length < 24 || PNG_SIGNATURE.some((b, k) => png[k] !== b) || String.fromCharCode(...png.subarray(12, 16)) !== "IHDR") return null
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { w: v.getUint32(16), h: v.getUint32(20) }
}

export async function decodeSat(job: SatJob): Promise<SatResult> {
  const size = pngSize(job.png)
  if (!size) return { ok: false, why: "it is not a PNG" }
  if (size.w * size.h > MAX_PIXELS) return { ok: false, why: `it is ${size.w} × ${size.h}, larger than the mosaic` }
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(job.png)], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" })
  const { width: w, height: h } = bitmap
  const ctx = new OffscreenCanvas(w, h).getContext("2d")
  if (!ctx) throw new Error("no 2D canvas")
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rgba = ctx.getImageData(0, 0, w, h).data
  const gray = new Uint8Array(w * h), alpha = new Uint8Array(w * h)
  let covered = 0
  for (let k = 0; k < w * h; k++) { gray[k] = rgba[k * 4]; alpha[k] = rgba[k * 4 + 3]; if (alpha[k] > 0) covered++ }
  const coverage = covered / (w * h)
  if (coverage < MIN_COVERAGE) return { ok: false, why: `it covers only ${Math.round(coverage * 100)}% of the world` }
  return { ok: true, field: satCloudField({ w, h, gray, alpha, latTop: job.latTop, latBottom: job.latBottom }), w, h, coverage }
}
