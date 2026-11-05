// Places beyond the globe's own list, by name, from Open-Meteo's geocoding (free, no key, CC BY 4.0; it answers
// cross-origin requests): the towns, regions and landmarks a name may mean, each with its region and country beside it.
// Parsing is pure; a malformed answer is left out.
import { meteoBudget } from "./meteoBudget"
import type { PlaceHit } from "./places"

export const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
const COUNT = 6
const TIMEOUT_MS = 8_000

export function geocodeUrl(name: string, count = COUNT): string {
  return `${GEOCODE_URL}?${new URLSearchParams({ name, count: String(count), language: "en", format: "json" }).toString()}`
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

export function parseGeocode(body: unknown): PlaceHit[] {
  const results = body != null && typeof body === "object" && Array.isArray((body as { results?: unknown }).results) ? (body as { results: unknown[] }).results : []
  return results.flatMap((r): PlaceHit[] => {
    if (r == null || typeof r !== "object") return []
    const o = r as Record<string, unknown>
    const name = text(o.name), lat = num(o.latitude), lon = num(o.longitude)
    // countries (GeoNames' political entities, PCL…) are left out: the globe lists its own; so is a place off the Earth
    if (!name || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || /^PCL/.test(text(o.feature_code) ?? "")) return []
    const detail = [text(o.admin1), text(o.country)].filter((s) => s != null && s !== name).join(", ")
    return [{ kind: "place", key: String(o.id ?? `${lat},${lon}`), name, detail, lat, lon }]
  }).slice(0, COUNT)
}

/** The places a name may mean; stopped when `signal` aborts (the typing went on) or after TIMEOUT_MS. */
export async function geocode(name: string, signal: AbortSignal): Promise<PlaceHit[]> {
  meteoBudget.spend(1)
  const ctl = new AbortController(), stop = () => ctl.abort()
  const timer = setTimeout(stop, TIMEOUT_MS)
  signal.addEventListener("abort", stop, { once: true })
  try {
    const res = await fetch(geocodeUrl(name), { headers: { accept: "application/json" }, signal: ctl.signal, credentials: "omit" })
    if (res.status !== 200) throw new Error(`the place search answered HTTP ${res.status}`)
    return parseGeocode(await res.json())
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", stop)
  }
}
