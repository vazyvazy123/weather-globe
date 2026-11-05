import { describe, expect, test } from "vitest"
import page from "../index.html?raw"
import sitemap from "../public/sitemap.xml?raw"
import robots from "../public/robots.txt?raw"
import llms from "../public/llms.txt?raw"
import headers from "../public/_headers?raw"

// The site's own address, as the page, the sitemap, robots.txt and llms.txt give it to search engines and AI engines:
// one address everywhere, or they hold two copies of the page apart.
const SITE = "https://josephsalhi.com/"

const attr = (pattern: RegExp): string | undefined => page.match(pattern)?.[1]

describe("the site's address", () => {
  test("is the page's canonical address, and its share card's", () => {
    expect(attr(/<link rel="canonical" href="([^"]+)"/)).toBe(SITE)
    expect(attr(/<meta property="og:url" content="([^"]+)"/)).toBe(SITE)
    expect(attr(/<meta property="og:image" content="([^"]+)"/)).toBe(`${SITE}og-image.jpg`)
    expect(attr(/<meta name="twitter:image" content="([^"]+)"/)).toBe(`${SITE}og-image.jpg`)
  })

  test("is the one the structured data, the sitemap, robots.txt and llms.txt name", () => {
    const ld = JSON.parse(attr(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? "{}") as { "@graph": Array<{ url?: string }> }
    expect(ld["@graph"].map((n) => n.url)).toEqual([SITE, SITE])
    expect(sitemap).toContain(`<loc>${SITE}</loc>`)
    expect(robots).toContain(`Sitemap: ${SITE}sitemap.xml`)
    expect(llms).toContain(`(${SITE})`)
  })

  test("is the only address of its own any of them gives", () => {
    const own = [page, sitemap, robots, llms].join("\n").match(/https:\/\/[a-z0-9.-]*salhi\.com/g) ?? []
    expect(new Set(own)).toEqual(new Set([SITE.slice(0, -1)]))
  })
})

describe("the app manifest", () => {
  test("is served as one (application/manifest+json)", () => {
    expect(headers).toMatch(/^\/site\.webmanifest\s*\n\s+Content-Type: application\/manifest\+json\s*$/m)
  })
})
