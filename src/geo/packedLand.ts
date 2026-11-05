// The fine coastline packed small: src/geo/worldLandFine.bin, written from worldLandFine.ts by scripts/pack-land.mjs.
// Written out as code, the rings were the page's largest download (225 KB gzipped); packed, they are a third of that.
// The file is gzipped by the script, not by the server (few servers compress binary data), and holds:
//   the bytes "LAND", the format (1), then whole numbers as varints (7 bits a byte, low bits first, the top bit set on
//   every byte but a number's last): the steps a degree is cut into, the number of rings, each ring's number of points
//   (its closing point, the same as its first, left out), then every point's longitude, then every point's latitude,
//   each as the steps from the point before (the first from 0), zig-zagged so a small step either way is a small number.
// Steps of 1/50° keep the source's 0.02° exactly: the rings unpacked are the very numbers of worldLandFine.ts.

const MAGIC = "LAND"
const FORMAT = 1
/** no number in the file needs more than 5 bytes (35 bits) */
const VARINT_MAX_BITS = 35

/** The whole numbers of `bytes` from `at`, read one after another. */
function varints(bytes: Uint8Array, at: number) {
  return {
    next(): number {
      let n = 0
      for (let shift = 0; shift < VARINT_MAX_BITS; shift += 7) {
        if (at >= bytes.length) throw new Error("the packed coastline ends early")
        const b = bytes[at++]
        n += (b & 0x7f) * 2 ** shift
        if (b < 0x80) return n
      }
      throw new Error("the packed coastline has a number too long")
    },
    left: () => bytes.length - at,
  }
}

/** a zig-zagged number back to one either way: 0, 1, 2, 3, 4… → 0, −1, 1, −2, 2… */
const unzigzag = (z: number) => (z % 2 ? -(z + 1) / 2 : z / 2)

/** The rings (flat lon, lat lists, each ending where it starts) of a packed coastline, unzipped. Anything else in its
 *  place (an error page, a file cut short) throws instead of drawing land that is not there. */
export function unpackLand(bytes: Uint8Array): number[][] {
  if ([...MAGIC].some((c, i) => bytes[i] !== c.charCodeAt(0))) throw new Error("not a packed coastline")
  if (bytes[MAGIC.length] !== FORMAT) throw new Error(`a packed coastline of format ${bytes[MAGIC.length]}, not ${FORMAT}`)
  const read = varints(bytes, MAGIC.length + 1)
  const steps = read.next()
  if (steps === 0) throw new Error("the packed coastline has no grid")
  const counts: number[] = []
  for (let r = read.next(); r > 0; r--) counts.push(read.next())
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (counts.includes(0)) throw new Error("the packed coastline has an empty ring")
  // each point is two numbers, a byte at least each
  if (2 * total > read.left()) throw new Error("the packed coastline ends early")
  const column = (): number[] => {
    const out: number[] = []
    for (let i = 0, q = 0; i < total; i++) { q += unzigzag(read.next()); out.push(q / steps) }
    return out
  }
  const lons = column(), lats = column()
  if (read.left() > 0) throw new Error("the packed coastline has bytes left over")
  const rings: number[][] = []
  let p = 0
  for (const n of counts) {
    const ring: number[] = []
    for (const end = p + n; p < end; p++) ring.push(lons[p], lats[p])
    ring.push(ring[0], ring[1])
    rings.push(ring)
  }
  return rings
}

/** A gzip file's bytes, unzipped by the browser itself. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const unzipped = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(unzipped).arrayBuffer())
}
