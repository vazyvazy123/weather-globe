// Two fingers on the globe zoom it as on a map: by how far they have spread apart or closed in since they both touched.
// (Globe.tsx follows the touches; the arithmetic is here.)

import { zoomed, type GlobeCamera } from "./camera"

export interface Point { x: number; y: number }

/** closer than this, two touches count as this far apart: fingers landing almost on each other cannot zoom by leaps */
export const MIN_SPREAD_PX = 24

export const spread = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The zoom factor of a pinch begun with its touches `start` px apart, now `now` px apart. */
export const pinchFactor = (start: number, now: number): number => Math.max(MIN_SPREAD_PX, now) / Math.max(MIN_SPREAD_PX, start)

/** The camera a pinch makes of the `live` one: the zoom it began at times `factor`, the globe left where it is now — so a
 *  follow of the ISS, which a change of zoom alone keeps going (camera.ts), carries on under the fingers. */
export const pinched = (live: GlobeCamera, startZoom: number, factor: number): GlobeCamera => zoomed({ ...live, zoom: startZoom }, factor)
