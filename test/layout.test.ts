import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

// The layout on a phone: what its stylesheets must keep for the page to stay usable there. (Read from disk: Vitest
// hands a stylesheet over empty, even ?raw.)
const sheet = (name: string): string => new TextDecoder().decode(readFileSync(new URL(`../src/ui/${name}`, import.meta.url)))
const styles = sheet("styles.css"), music = sheet("music.css")
const PHONE = "(max-width: 640px)"

/** the body of the `@media <query>` block (its braces matched) */
function media(css: string, query: string): string {
  const start = css.indexOf(`@media ${query} {`)
  if (start < 0) return ""
  let depth = 0
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i)
  }
  return ""
}
/** the declarations of the rule whose selector list starts with `selector` (top level, or inside a media block) */
const rule = (css: string, selector: string): string => css.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{([^}]*)\\}`))?.[1] ?? ""
const value = (decls: string, prop: string): string | undefined => decls.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+)`))?.[1].trim()
const zIndex = (css: string, selector: string): number => Number(value(rule(css, selector), "z-index") ?? 0)

describe("the toolbar's menus", () => {
  test("open over everything on the globe's stage", () => {
    const bar = zIndex(styles, ".bar")
    for (const [css, overlay] of [[styles, ".stage-search"], [styles, ".panel"], [styles, ".zoom"], [styles, ".corner"], [music, ".dock"]] as const) {
      expect(bar, overlay).toBeGreaterThan(zIndex(css, overlay))
    }
  })
})

describe("the search's list of places", () => {
  test("opens over the zoom, a panel and the player", () => {
    const search = zIndex(styles, ".stage-search")
    for (const [css, overlay] of [[styles, ".panel"], [styles, ".zoom"], [music, ".dock"]] as const) {
      expect(search, overlay).toBeGreaterThan(zIndex(css, overlay))
    }
  })
})

describe("on a phone", () => {
  const phone = media(styles, PHONE)

  test("the search's text is big enough that Safari does not zoom the page into it, its completion matching it", () => {
    const search = rule(phone, ".search-field input")
    expect(search).not.toBe("")
    expect(parseFloat(value(search, "font-size") ?? "0")).toBeGreaterThanOrEqual(16)
    expect(phone).toMatch(/\.search-field input, \.search-ghost \{/)
  })

  test("a city's panel is a sheet at the bottom that scrolls, rather than running off the screen", () => {
    const panel = rule(phone, ".panel")
    expect(value(panel, "bottom")).toBeDefined()
    expect(value(panel, "max-height")).toBeDefined()
    expect(value(panel, "overflow-y") ?? value(rule(styles, ".panel"), "overflow-y")).toBe("auto")
  })

  test("the page's text is never enlarged by the browser on its own", () => {
    expect(value(rule(styles, "html"), "-webkit-text-size-adjust")).toBe("100%")
  })
})

describe("on a short screen", () => {
  test("a panel scrolls within the stage, never past its bottom", () => {
    const panel = rule(styles, ".panel")
    expect(value(panel, "max-height")).toMatch(/100%/)
    expect(value(panel, "overflow-y")).toBe("auto")
  })
})
