// The types of scripts/pack-land.mjs, for the tests that pack rings with it.

/** The rings (flat lon, lat lists, each ending where it starts) packed as src/geo/packedLand.ts reads them, before
 *  gzip: each point on a grid of `steps` to a degree. Throws on a ring that is not closed or a point off the globe. */
export function packLand(rings: ReadonlyArray<readonly number[]>, steps: number): Uint8Array
