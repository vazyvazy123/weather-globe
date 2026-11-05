// Packs the fine coastline (src/geo/worldLandFine.ts: Natural Earth 1:50m, 0.02° steps) into the small file the page
// fetches (src/geo/worldLandFine.bin), in the format src/geo/packedLand.ts reads and describes: each point the steps
// from the one before as a varint, the longitudes and the latitudes apart, gzipped here so no server need compress it.
// Run it when the coastline changes; test/packedLand.test.ts checks that the file still unpacks to those very rings.
//
//   node scripts/pack-land.mjs

import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { constants, gzipSync } from "node:zlib"

const ROOT = new URL("..", import.meta.url)
const SOURCE = new URL("src/geo/worldLandFine.ts", ROOT)
const OUT = new URL("src/geo/worldLandFine.bin", ROOT)
/** the steps a degree is cut into: the source's 0.02° kept exactly */
const STEPS_PER_DEGREE = 50
const MAGIC = "LAND"
const FORMAT = 1
/** where a gzip header names the machine that wrote it, and its "unknown" (RFC 1952) */
const GZIP_OS_BYTE = 9
const GZIP_OS_UNKNOWN = 255

/** n (whole, not negative) as a varint: 7 bits a byte, low bits first, the top bit set on every byte but the last */
function pushVarint(out, n) {
  for (; n >= 0x80; n = Math.floor(n / 0x80)) out.push((n % 0x80) | 0x80)
  out.push(n)
}

/** a whole number either way as one that is not negative: 0, −1, 1, −2, 2… → 0, 1, 2, 3, 4… */
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n)

/** The rings (flat lon, lat lists, each ending where it starts) packed as src/geo/packedLand.ts reads them, before
 *  gzip: each point on a grid of `steps` to a degree. */
export function packLand(rings, steps) {
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`a degree cannot be cut into ${steps} steps`)
  const head = [...MAGIC].map((c) => c.charCodeAt(0))
  head.push(FORMAT)
  pushVarint(head, steps)
  pushVarint(head, rings.length)
  const lons = [], lats = []
  let lastX = 0, lastY = 0
  for (const ring of rings) {
    const n = ring.length / 2 - 1
    if (!Number.isInteger(n) || n < 1 || ring[0] !== ring[2 * n] || ring[1] !== ring[2 * n + 1]) {
      throw new Error(`the ring from ${ring[0]}, ${ring[1]} is not closed: it must end where it starts`)
    }
    pushVarint(head, n)
    for (let i = 0; i < n; i++) {
      const lon = ring[2 * i], lat = ring[2 * i + 1]
      // (not a number fails too)
      if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) throw new Error(`the point ${lon}, ${lat} is not on the globe`)
      const x = Math.round(lon * steps), y = Math.round(lat * steps)
      pushVarint(lons, zigzag(x - lastX))
      pushVarint(lats, zigzag(y - lastY))
      lastX = x
      lastY = y
    }
  }
  return Uint8Array.from([...head, ...lons, ...lats])
}

/** the rings of src/geo/worldLandFine.ts: its one array, read as JSON */
async function sourceRings() {
  const text = await readFile(SOURCE, "utf8")
  return JSON.parse(text.slice(text.indexOf("= [") + 2).replace(/,\s*\]\s*$/, "]"))
}

async function main() {
  const rings = await sourceRings()
  const packed = packLand(rings, STEPS_PER_DEGREE)
  const zipped = gzipSync(packed, { level: constants.Z_BEST_COMPRESSION })
  // the header's operating-system byte as "unknown": the same file, and the same asset name, from any machine
  zipped[GZIP_OS_BYTE] = GZIP_OS_UNKNOWN
  let points = 0, moved = 0
  for (const ring of rings) {
    points += ring.length / 2
    for (const v of ring) moved = Math.max(moved, Math.abs(Math.round(v * STEPS_PER_DEGREE) / STEPS_PER_DEGREE - v))
  }
  await writeFile(OUT, zipped)
  console.log(`${rings.length} rings, ${points} points: ${packed.length} bytes packed, ${zipped.length} gzipped, written to src/geo/worldLandFine.bin`)
  console.log(`the furthest a point moved onto the 1/${STEPS_PER_DEGREE}° grid: ${moved}°`)
}

// run from the command line, not when a test imports packLand
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
