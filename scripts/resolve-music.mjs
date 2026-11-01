// Resolves the hand-picked songs (scripts/music-picks.json) into the catalog the globe plays (src/data/musicCatalog.json):
//  - the song itself from Apple's iTunes Search API: its 30-second preview, its cover and its Apple Music page — the
//    US store first, then the store of the song's own country; a pick is kept only when both the artist and the title
//    match (any of their spellings, `artistAka` / `aka`) — or, where the search finds the wrong recording (a remix, a
//    namesake), the exact track the pick names (`itunesId`, from its `store`);
//  - the singer's photo from Deezer's artist search, when one matches by name.
// Every address it writes is a stable CDN link, so the page needs no API call to play a song.
// A pick already in the catalog is kept as it is; `--refresh` resolves them all again.
//
//   node scripts/resolve-music.mjs [--refresh]

import { readFile, writeFile } from "node:fs/promises"

const ROOT = new URL("..", import.meta.url)
const PICKS = new URL("scripts/music-picks.json", ROOT)
const CITIES = new URL("src/data/cities.ts", ROOT)
const OUT = new URL("src/data/musicCatalog.json", ROOT)
/** iTunes allows about 20 searches a minute */
const ITUNES_GAP_MS = 3200
const DEEZER_GAP_MS = 250
const COVER_PX = 600
const TERMS_PER_STORE = 3
const SKIP = /\b(karaoke|instrumental|tribute|cover version|8-bit|lullaby|made famous)\b/i
const WORSE = /\b(live|remix|mix|version|edit|acoustic|session|remaster(ed)?)\b/i

const sleep = (ms) => new Promise((go) => setTimeout(go, ms))

/** for matching: no accents, no brackets, no "feat.", letters and digits only */
export function norm(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(feat|ft)\..*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}
const has = (hay, needle) => ` ${hay} `.includes(` ${needle} `)

function artistOk(pick, name) {
  const got = norm(name)
  if (!got) return false
  return [pick.artist, ...(pick.artistAka ?? [])].map(norm).some((n) => n && (got === n || has(got, n) || has(n, got)))
}

function titleOk(pick, name) {
  const got = norm(name)
  if (!got) return false
  return [pick.title, ...(pick.aka ?? [])].map(norm).some((t) => t && (got === t || has(got, t)))
}

/** how good a match is (lower is better): the exact title, then not live / remixed, then iTunes' own order */
function score(pick, r, i) {
  const exact = [pick.title, ...(pick.aka ?? [])].map(norm).includes(norm(r.trackName)) ? 0 : 1
  const worse = WORSE.test(`${r.trackName} ${r.collectionName ?? ""}`) ? 1 : 0
  return exact * 1000 + worse * 100 + i
}

let lastItunes = 0
async function itunes(term, store) {
  const wait = lastItunes + ITUNES_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastItunes = Date.now()
  const q = new URLSearchParams({ term, entity: "song", limit: "25", country: store })
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(20_000) })
    if (res.status === 403 || res.status === 429) { console.warn(`  iTunes said ${res.status}; waiting a minute`); await sleep(60_000); continue }
    if (res.status === 400 || res.status === 404) return [] // no such store
    if (!res.ok) throw new Error(`iTunes answered HTTP ${res.status}`)
    const body = await res.json()
    return Array.isArray(body.results) ? body.results : []
  }
  return []
}

let lastDeezer = 0
const photos = new Map()
async function artistPhoto(pick) {
  const key = norm(pick.artist)
  if (photos.has(key)) return photos.get(key)
  let found = null
  for (const name of [pick.artist, ...(pick.artistAka ?? [])].slice(0, 2)) {
    const wait = lastDeezer + DEEZER_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastDeezer = Date.now()
    try {
      const res = await fetch(`https://api.deezer.com/search/artist?${new URLSearchParams({ q: name, limit: "5" })}`, { signal: AbortSignal.timeout(20_000) })
      const body = res.ok ? await res.json() : null
      const hit = (body?.data ?? []).find((a) => artistOk(pick, a.name) && typeof a.picture_big === "string" && !a.picture_big.includes("/artist//"))
      if (hit) { found = hit.picture_big; break }
    } catch (err) {
      console.warn(`  Deezer: ${err instanceof Error ? err.message : err}`)
    }
  }
  photos.set(key, found)
  return found
}

/** A pick pinned to one iTunes track (`itunesId`, from `store`): that track, when it still has a preview. */
async function lookup(pick) {
  const wait = lastItunes + ITUNES_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastItunes = Date.now()
  const store = pick.store ?? "us"
  const res = await fetch(`https://itunes.apple.com/lookup?${new URLSearchParams({ id: String(pick.itunesId), country: store })}`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`iTunes lookup answered HTTP ${res.status}`)
  const r = (await res.json()).results?.[0]
  return r?.kind === "song" && r.previewUrl ? { r, store } : null
}

function cleanAppleUrl(u) {
  try { const url = new URL(u); url.searchParams.delete("uo"); return url.toString() } catch { return null }
}

async function resolve(pick, country) {
  const stores = [...new Set(["us", country.toLowerCase()])]
  const terms = [...new Set([
    `${pick.artist} ${pick.title}`,
    ...(pick.aka ?? []).map((t) => `${pick.artist} ${t}`),
    ...(pick.artistAka ?? []).map((a) => `${a} ${pick.title}`),
  ])].slice(0, TERMS_PER_STORE)
  for (const store of stores) {
    for (const term of terms) {
      const results = await itunes(term, store)
      const ok = results
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.kind === "song" && r.previewUrl && artistOk(pick, r.artistName) && titleOk(pick, r.trackName) && !SKIP.test(`${r.trackName} ${r.collectionName ?? ""} ${r.artistName}`))
        .sort((a, b) => score(pick, a.r, a.i) - score(pick, b.r, b.i))
      if (ok.length) return { r: ok[0].r, store }
    }
  }
  return null
}

async function main() {
  const refresh = process.argv.includes("--refresh")
  const picks = JSON.parse(await readFile(PICKS, "utf8"))
  const countryOf = new Map([...(await readFile(CITIES, "utf8")).matchAll(/id: "(\w+)".*?country: "([A-Z]{2})"/g)].map((m) => [m[1], m[2]]))
  let held = []
  try { held = JSON.parse(await readFile(OUT, "utf8")) } catch { /* no catalog yet */ }
  const heldBy = new Map(held.map((t) => [`${t.city}|${norm(t.artist)}|${norm(t.title)}`, t]))

  const out = [], missed = []
  for (const pick of picks) {
    const country = countryOf.get(pick.city)
    if (!country) throw new Error(`"${pick.artist} — ${pick.title}": no city "${pick.city}" in src/data/cities.ts`)
    const key = `${pick.city}|${norm(pick.artist)}|${norm(pick.title)}`
    const kept = heldBy.get(key)
    if (kept && !refresh && (pick.itunesId == null || kept.itunesId === pick.itunesId)) { out.push({ ...kept, genre: pick.genre }); continue }
    const found = pick.itunesId != null ? await lookup(pick) : await resolve(pick, country)
    if (!found) { missed.push(pick); console.log(`MISS  ${pick.city}  ${pick.artist} — ${pick.title}`); continue }
    const { r, store } = found
    const track = {
      id: `${pick.city}-${r.trackId}`,
      city: pick.city,
      artist: pick.artist,
      title: pick.title,
      genre: pick.genre,
      album: r.collectionName ?? null,
      year: typeof r.releaseDate === "string" ? Number(r.releaseDate.slice(0, 4)) || null : null,
      preview: r.previewUrl,
      cover: typeof r.artworkUrl100 === "string" ? r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${COVER_PX}x${COVER_PX}bb.jpg`) : null,
      artistImage: await artistPhoto(pick),
      appleUrl: cleanAppleUrl(r.trackViewUrl),
      itunesId: r.trackId,
    }
    out.push(track)
    console.log(`OK    ${pick.city}  ${pick.artist} — ${pick.title}   ⇐ [${store}] ${r.artistName} — ${r.trackName} (${r.collectionName})${track.artistImage ? "" : "  · no photo"}`)
  }
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`\n${out.length} songs written to src/data/musicCatalog.json; ${missed.length} not found`)
}

main().catch((err) => { console.error(err); process.exit(1) })
