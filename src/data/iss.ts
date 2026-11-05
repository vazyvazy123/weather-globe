// The ISS's orbital elements (its TLE) from wheretheiss.at (free, no key; it answers cross-origin requests and allows
// 350 requests in 5 minutes): read when the stored ones are older than ISS_EVERY_MS — new elements come out a few times
// a day, and each set is good for a day or so either side of its epoch, so the ISS is placed between reads without
// asking (orbit.ts). Parsing is pure.
import { parseTle } from "../geo/orbit"

export const ISS_TLE_URL = "https://api.wheretheiss.at/v1/satellites/25544/tles?format=json"
export const ISS_EVERY_MS = 6 * 3600_000
const TIMEOUT_MS = 15_000

export interface IssTle { readonly line1: string; readonly line2: string }

/** The answer's two lines; null where they are not elements. */
export function parseIssTle(body: unknown): IssTle | null {
  if (body == null || typeof body !== "object") return null
  const { line1, line2 } = body as Record<string, unknown>
  return typeof line1 === "string" && typeof line2 === "string" && parseTle(line1, line2) ? { line1, line2 } : null
}

export async function fetchIssTle(): Promise<IssTle> {
  const res = await fetch(ISS_TLE_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "omit" })
  if (res.status !== 200) throw new Error(`wheretheiss.at answered HTTP ${res.status}`)
  const tle = parseIssTle(await res.json())
  if (!tle) throw new Error("wheretheiss.at sent no elements")
  return tle
}
