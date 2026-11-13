import type { GlobeCamera } from "./camera"

/** The seven continents the toolbar's Regions menu flies to, each framed whole (Antarctica from as far south as the
 *  camera tilts, 70°S, the pole in sight beyond it). */
export const REGIONS: ReadonlyArray<readonly [string, GlobeCamera]> = [
  ["North America", { lon: -100, lat: 45, zoom: 1.7 }],
  ["South America", { lon: -60, lat: -24, zoom: 1.6 }],
  ["Europe", { lon: 15, lat: 52, zoom: 2.6 }],
  ["Africa", { lon: 18, lat: 2, zoom: 1.7 }],
  ["Asia", { lon: 95, lat: 38, zoom: 1.5 }],
  ["Australia", { lon: 145, lat: -27, zoom: 2 }],
  ["Antarctica", { lon: 0, lat: -70, zoom: 1.6 }],
]
