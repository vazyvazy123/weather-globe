// The clouds as a camera sees them: a geostationary satellite's red visible band (GOES-East, GOES-West, Himawari; ~1 km,
// every 10 minutes) turned into how much cloud each pixel shows — real cloud texture (cumulus streets, cirrus veils,
// the sunlit and shaded sides of storm tops) instead of the shapes the infrared can only outline.
// A cloud is brighter than the ground under it, so each pixel is weighed against the clear ground around it: the
// darkest tenth of its block (raised by bright ground, but at most CLEAR_MAX, so a wide overcast still reads as cloud),
// smoothed between blocks. What stands above that, divided by how high the sun stood there at the picture's time, is
// the cloud. The picture is trusted by day only, fading out toward dusk (where its light fails) and where it has no data.
// Pure.
import { smooth } from "../geo/smoothstep"
import { subsolarPoint } from "../geo/sun"

/** where the picture lies (its north-west corner, degrees a pixel) and when it was taken */
export interface VisArea { west: number; north: number; res: number; timeMs: number }

/** the blocks the clear ground is measured over (°) and the share of their darkest pixels that is clear */
const BLOCK_DEG = 1.5
const CLEAR_Q = 0.1
/** the brightest the clear ground may be (bright desert or snow is still lower than thick cloud) */
const CLEAR_MAX = 90
/** a block with fewer pixels than this takes the usual clear level */
const CLEAR_MIN_PX = 16
const CLEAR_USUAL = 30
/** brightness above the clear ground (a share of full white, the sun overhead) where cloud starts, and where it is full */
const VIS_FROM = 0.04, VIS_FULL = 0.5
/** the sun lower than this is taken as this high (the picture's own light is dimmer, not the cloud thinner) */
const COS_MIN = 0.25
/** the picture is trusted from this height of the sun (cosine of its zenith angle) */
const TRUST_FROM = 0.04, TRUST_FULL = 0.18
const RAD = Math.PI / 180

/** The q-quantile of a 256-bin histogram of n values. */
function quantile(hist: Uint32Array, n: number, q: number): number {
  const target = Math.max(1, Math.ceil(q * n))
  let seen = 0
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= target) return v }
  return 255
}

/** How much cloud each pixel of a visible picture shows (0–255) and how far to trust it (0–255: by day, with data). */
export function visibleClouds(gray: Uint8Array, alpha: Uint8Array, w: number, h: number, area: VisArea): { cloud: Uint8Array; trust: Uint8Array } {
  const n = w * h
  const cloud = new Uint8Array(n), trust = new Uint8Array(n)
  // the sun's height at each pixel, at the picture's time: separable in latitude and longitude
  const sun = subsolarPoint(area.timeMs)
  const sd = Math.sin(sun.lat * RAD), cd = Math.cos(sun.lat * RAD)
  const rowA = new Float32Array(h), rowB = new Float32Array(h), colC = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    const lat = (area.north - (y + 0.5) * area.res) * RAD
    rowA[y] = Math.sin(lat) * sd
    rowB[y] = Math.cos(lat) * cd
  }
  for (let x = 0; x < w; x++) colC[x] = Math.cos((area.west + (x + 0.5) * area.res - sun.lon) * RAD)

  // the clear ground of each block
  const B = Math.max(8, Math.round(BLOCK_DEG / area.res))
  const nbx = Math.ceil(w / B), nby = Math.ceil(h / B)
  const clear = new Float32Array(nbx * nby)
  const hist = new Uint32Array(256)
  for (let j = 0; j < nby; j++) for (let i = 0; i < nbx; i++) {
    hist.fill(0)
    let c = 0
    for (let y = j * B; y < Math.min(h, (j + 1) * B); y++) for (let x = i * B; x < Math.min(w, (i + 1) * B); x++) {
      const k = y * w + x
      if (alpha[k] > 0) { hist[gray[k]]++; c++ }
    }
    clear[j * nbx + i] = c >= CLEAR_MIN_PX ? Math.min(CLEAR_MAX, quantile(hist, c, CLEAR_Q)) : CLEAR_USUAL
  }

  for (let y = 0; y < h; y++) {
    const fy = Math.min(nby - 1, Math.max(0, (y + 0.5) / B - 0.5)), j0 = Math.floor(fy), j1 = Math.min(nby - 1, j0 + 1), ty = fy - j0
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (alpha[k] === 0) continue
      const cz = rowA[y] + rowB[y] * colC[x]
      if (cz <= TRUST_FROM) continue
      const fx = Math.min(nbx - 1, Math.max(0, (x + 0.5) / B - 0.5)), i0 = Math.floor(fx), i1 = Math.min(nbx - 1, i0 + 1), tx = fx - i0
      const level = (clear[j0 * nbx + i0] * (1 - tx) + clear[j0 * nbx + i1] * tx) * (1 - ty) + (clear[j1 * nbx + i0] * (1 - tx) + clear[j1 * nbx + i1] * tx) * ty
      const above = (gray[k] - level) / (255 * Math.max(cz, COS_MIN))
      cloud[k] = Math.round(smooth(VIS_FROM, VIS_FULL, above) * 255)
      trust[k] = Math.round(smooth(TRUST_FROM, TRUST_FULL, cz) * alpha[k])
    }
  }
  return { cloud, trust }
}
