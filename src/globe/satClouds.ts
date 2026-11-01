// The globe's clouds from a satellite: NOAA's global mosaic of geostationary infrared images (GMGSI longwave, ~3 km,
// hourly, fetched by the browser from NOAA nowCOAST) turned into how much cloud each pixel shows. In infrared a cloud top is colder —
// brighter in the image — than the ground under a clear sky; but the clear ground itself brightens toward the poles and
// over cold land, so each pixel is weighed against the clear sky around it: the 20th-percentile brightness of its
// latitude, raised toward the local clear level where the ground is colder (by at most CLEAR_LIFT, so a wide overcast
// still reads as cloud), and the cloud is how far above that the pixel stands. Low warm cloud (fog, coastal stratus) is
// about as warm as the ground and barely shows. Pure.
import { smooth } from "../geo/smoothstep"

/** The satellite's cloud field for the globe: the hour its image shows, and satCloudField's bytes. */
export interface SatField {
  timeMs: number
  /** RGBA: r = cloud, g = high cold cloud, a = coverage — the world in longitude, latTop down to latBottom */
  field: Uint8Array
  w: number
  h: number
  latTop: number
  latBottom: number
  /** the share of the image with data */
  coverage: number
}

export interface SatImage {
  w: number
  h: number
  /** brightness per pixel, row 0 at the top (latTop) */
  gray: Uint8Array
  /** coverage per pixel (0 = no data); null = all covered */
  alpha: Uint8Array | null
  /** the latitudes of the image's top and bottom edges (°) */
  latTop: number
  latBottom: number
}

/** the blocks the local clear sky is measured over (°), whatever the image's size */
const BLOCK_DEG_W = 5.6, BLOCK_DEG_H = 4.2
const ZONAL_Q = 0.2, LOCAL_Q = 0.15
/** how far a cold surface may lift the clear-sky level above its latitude's */
const CLEAR_LIFT = 25
/** brightness above the clear sky where cloud starts, and where it is full */
const CLOUD_FROM = 14, CLOUD_FULL = 70
/** the columns at each edge of the image that may be empty (the map service's, at the date line) */
const EDGE_PX = 2
/** the brightness of high, cold cloud tops */
const HIGH_FROM = 170, HIGH_FULL = 215
/** the latitude band the clear level of a row is smoothed over (°) */
const ZONAL_SMOOTH_DEG = 3


/** The q-quantile of the values counted in a 256-bin histogram of n values. */
function quantile(hist: Uint32Array, n: number, q: number): number {
  const target = Math.max(1, Math.ceil(q * n))
  let seen = 0
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= target) return v }
  return 255
}

/** Fills the NaNs of a list from the nearest value on either side. */
function fillGaps(a: Float32Array): void {
  let last = NaN
  for (let i = 0; i < a.length; i++) { if (Number.isNaN(a[i])) a[i] = last; else last = a[i] }
  last = NaN
  for (let i = a.length - 1; i >= 0; i--) { if (Number.isNaN(a[i])) a[i] = last; else last = a[i] }
}

/** The cloud field: RGBA bytes the image's size — r = how much cloud, g = how much of it is high cold cloud, b = 0,
 *  a = the image's coverage. */
export function satCloudField(img: SatImage): Uint8Array {
  const { w, h, gray, alpha } = img
  const covered = (k: number) => alpha == null || alpha[k] > 0
  // the clear level of each row: its 20th percentile, smoothed over a few degrees of latitude
  const rowQ = new Float32Array(h)
  const hist = new Uint32Array(256)
  for (let y = 0; y < h; y++) {
    hist.fill(0)
    let n = 0
    for (let x = 0; x < w; x++) { const k = y * w + x; if (covered(k)) { hist[gray[k]]++; n++ } }
    rowQ[y] = n >= 32 ? quantile(hist, n, ZONAL_Q) : NaN
  }
  fillGaps(rowQ)
  const rowsPerDeg = h / Math.max(1e-6, img.latTop - img.latBottom), r = Math.max(1, Math.round(ZONAL_SMOOTH_DEG * rowsPerDeg))
  const zonal = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0, c = 0
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (!Number.isNaN(rowQ[k])) { s += rowQ[k]; c++ }
    zonal[y] = c ? s / c : 0
  }
  // the clear level of each block: its own low percentile, but never more than CLEAR_LIFT above its latitude's
  const BLOCK_W = Math.max(8, Math.round((BLOCK_DEG_W * w) / 360)), BLOCK_H = Math.max(6, Math.round(BLOCK_DEG_H * rowsPerDeg))
  const nbx = Math.ceil(w / BLOCK_W), nby = Math.ceil(h / BLOCK_H)
  const bg = new Float32Array(nbx * nby)
  for (let j = 0; j < nby; j++) {
    const z = zonal[Math.min(h - 1, j * BLOCK_H + (BLOCK_H >> 1))]
    for (let i = 0; i < nbx; i++) {
      hist.fill(0)
      let n = 0
      for (let y = j * BLOCK_H; y < Math.min(h, (j + 1) * BLOCK_H); y++) for (let x = i * BLOCK_W; x < Math.min(w, (i + 1) * BLOCK_W); x++) {
        const k = y * w + x
        if (covered(k)) { hist[gray[k]]++; n++ }
      }
      const local = n >= 16 ? quantile(hist, n, LOCAL_Q) : z
      bg[j * nbx + i] = Math.max(z, Math.min(local, z + CLEAR_LIFT))
    }
  }
  // smoothed over the blocks around (round the world in longitude)
  const bgS = new Float32Array(bg.length)
  for (let j = 0; j < nby; j++) for (let i = 0; i < nbx; i++) {
    let s = 0, c = 0
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj
      if (jj < 0 || jj >= nby) continue
      for (let di = -1; di <= 1; di++) { s += bg[jj * nbx + ((i + di + nbx) % nbx)]; c++ }
    }
    bgS[j * nbx + i] = s / c
  }
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(nby - 1, Math.max(0, (y + 0.5) / BLOCK_H - 0.5)), j0 = Math.floor(fy), j1 = Math.min(nby - 1, j0 + 1), ty = fy - j0
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!covered(k)) continue
      const fx = (x + 0.5) / BLOCK_W - 0.5, i0f = Math.floor(fx), tx = fx - i0f
      const i0 = ((i0f % nbx) + nbx) % nbx, i1 = (i0 + 1) % nbx
      const level = (bgS[j0 * nbx + i0] * (1 - tx) + bgS[j0 * nbx + i1] * tx) * (1 - ty) + (bgS[j1 * nbx + i0] * (1 - tx) + bgS[j1 * nbx + i1] * tx) * ty
      const g = gray[k], cloud = smooth(CLOUD_FROM, CLOUD_FULL, g - level)
      out[k * 4] = Math.round(cloud * 255)
      out[k * 4 + 1] = Math.round(smooth(HIGH_FROM, HIGH_FULL, g) * cloud * 255)
      out[k * 4 + 3] = alpha == null ? 255 : alpha[k]
    }
  }
  // the map service leaves the image's first and last columns empty: at the date line, where they meet, an empty column
  // would draw a seam down the globe — they take the nearest covered pixel's values in their row
  if (alpha != null) {
    for (let y = 0; y < h; y++) {
      for (const x of [...Array(EDGE_PX).keys(), ...Array.from({ length: EDGE_PX }, (_, k) => w - 1 - k)]) {
        const k = y * w + x
        if (covered(k)) continue
        const inward = x < w / 2 ? 1 : -1
        for (let d = 1; d <= 2 * EDGE_PX; d++) {
          const j = y * w + x + inward * d
          if (covered(j)) { out.copyWithin(k * 4, j * 4, j * 4 + 4); break }
        }
      }
    }
  }
  return out
}
