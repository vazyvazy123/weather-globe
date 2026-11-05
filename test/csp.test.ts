import { describe, expect, test } from "vitest"
import headers from "../public/_headers?raw"
import catalog from "../src/data/musicCatalog.json"
import { GEOCODE_URL } from "../src/data/geocode"
import { ISS_TLE_URL } from "../src/data/iss"
import { SAT_WMS_URL } from "../src/data/satellite"
import { GIBS_WMS, GIBS_WMTS } from "../src/data/tileFetcher"
import { OPEN_METEO_URL } from "../src/data/weather"

// The Content-Security-Policy the site is served with (public/_headers) against every host the app reaches: a host
// left out of it works in development and breaks only once deployed.
const csp = new Map(
  (headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...sources]) => [name, sources]),
)

/** whether the directive lets `url` through: its origin named, or a wildcard (https://*.host) covering it */
const allows = (directive: string, url: string): boolean => {
  const { protocol, host } = new URL(url)
  return (csp.get(directive) ?? []).some((s) => s === `${protocol}//${host}` || (s.startsWith(`${protocol}//*.`) && host.endsWith(s.slice(protocol.length + 3))))
}

describe("the site's Content-Security-Policy", () => {
  test("lets the app fetch from every host it reads (weather, wind, places, the ISS, satellites, land)", () => {
    for (const url of [OPEN_METEO_URL, GEOCODE_URL, ISS_TLE_URL, SAT_WMS_URL, GIBS_WMTS, GIBS_WMS]) expect(allows("connect-src", url), url).toBe(true)
  })

  test("lets the player show every cover and singer's photo, and play every preview", () => {
    for (const t of catalog) {
      if (t.preview) expect(allows("media-src", t.preview), t.preview).toBe(true)
      if (t.cover) expect(allows("img-src", t.cover), t.cover).toBe(true)
      if (t.artistImage) expect(allows("img-src", t.artistImage), t.artistImage).toBe(true)
    }
  })

  test("runs only the site's own scripts, and nothing it does not name", () => {
    expect(csp.get("default-src")).toEqual(["'none'"])
    expect(csp.get("script-src")).toEqual(["'self'"])
    expect(csp.get("frame-ancestors")).toEqual(["'none'"])
  })

  test("is not met by a host it leaves out", () => {
    expect(allows("connect-src", "https://example.com/x")).toBe(false)
    expect(allows("img-src", "https://mzstatic.com.example.com/x.jpg")).toBe(false)
  })
})
