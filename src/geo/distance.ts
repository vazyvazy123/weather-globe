/** the Earth's mean radius (km) */
export const EARTH_KM = 6371.0088
const RAD = Math.PI / 180

/** The circle of places an angle `radius` (rad) round a place (degrees), `n` steps round and back to the start. */
export function smallCircle(lat: number, lon: number, radius: number, n: number): Array<{ lat: number; lon: number }> {
  const p = lat * RAD, sp = Math.sin(p), cp = Math.cos(p), sr = Math.sin(radius), cr = Math.cos(radius)
  return Array.from({ length: n + 1 }, (_, k) => {
    const b = (2 * Math.PI * k) / n, lat2 = Math.asin(sp * cr + cp * sr * Math.cos(b))
    return { lat: lat2 / RAD, lon: lon + Math.atan2(Math.sin(b) * sr * cp, cr - sp * Math.sin(lat2)) / RAD }
  })
}

/** The distance (km) along the Earth's surface between two places (degrees), by the haversine formula. */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
