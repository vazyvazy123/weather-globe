// Request pacing and caching shared by every data source, so a browser running the globe stays a polite client of free
// public services:
//  - Lane: at most `max` requests at once and `perMinute` started in any minute; past that a request is refused, not
//    queued (the caller tries again later);
//  - cachedBytes: a response kept in the browser's Cache Storage (pictures that never change, such as NASA's Blue Marble
//    tiles), so a reload asks the network for nothing it already has;
//  - stored / store: small JSON answers kept in localStorage with the time they were read, so a reload within a
//    source's refresh interval makes no request at all.
// Every storage call fails soft: a private window or a full disk only costs the cache, never the globe.

export class Lane {
  private active = 0
  private readonly waiting: Array<() => void> = []
  private readonly starts: number[] = []
  constructor(private readonly max: number, private readonly perMinute: number, private readonly now: () => number = Date.now) {}

  /** the share of this minute's requests already started (0..1) */
  usage(): number {
    const t = this.now()
    return this.starts.filter((s) => t - s <= 60_000).length / this.perMinute
  }

  async run<T>(fn: () => Promise<T>): Promise<T | "refused"> {
    const t = this.now()
    while (this.starts.length && t - this.starts[0] > 60_000) this.starts.shift()
    if (this.starts.length + this.waiting.length >= this.perMinute) return "refused"
    // a finished request hands its place straight to the next one waiting
    if (this.active >= this.max) await new Promise<void>((go) => this.waiting.push(go))
    else this.active++
    this.starts.push(this.now())
    try {
      return await fn()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}

/** One GET with a timeout: the status and, for a 200, the body's bytes. */
export async function getBytes(url: string, timeoutMs: number, accept = "*/*"): Promise<{ status: number; bytes: Uint8Array }> {
  const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(timeoutMs), credentials: "omit" })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, bytes: res.status === 200 ? bytes : new Uint8Array(0) }
}

const hasCaches = (): boolean => typeof caches !== "undefined"

/** A picture from Cache Storage, or null when it is not held (or the cache is unavailable). */
export async function cachedBytes(cacheName: string, url: string): Promise<Uint8Array | null> {
  if (!hasCaches()) return null
  try {
    const hit = await (await caches.open(cacheName)).match(url)
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null
  } catch {
    return null
  }
}

/** Keeps a picture in Cache Storage under its address. */
export async function keepBytes(cacheName: string, url: string, bytes: Uint8Array, type: string): Promise<void> {
  if (!hasCaches()) return
  try {
    await (await caches.open(cacheName)).put(url, new Response(bytes as BlobPart, { headers: { "content-type": type } }))
  } catch {
    // quota or a private window: the picture is simply fetched again next time
  }
}

/** Drops the oldest entries of a cache past `keep` (Cache Storage lists them in insertion order). */
export async function trimCache(cacheName: string, keep: number): Promise<void> {
  if (!hasCaches()) return
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    for (const req of keys.slice(0, Math.max(0, keys.length - keep))) await cache.delete(req)
  } catch {
    // nothing to trim
  }
}

interface Stored<T> { atMs: number; value: T }

/** a value stored later than this after now (by a clock that was ahead) is not trusted: it would look fresh for ever */
const CLOCK_SLACK_MS = 60_000

/** A JSON value kept in localStorage, with the time it was stored; null when absent, unreadable, stored in the future,
 *  or not what `valid` asks for (an old or damaged entry). */
export function stored<T>(key: string, valid?: (v: unknown) => boolean): Stored<T> | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored<unknown>>
    if (typeof v.atMs !== "number" || v.value === undefined || v.atMs > Date.now() + CLOCK_SLACK_MS) return null
    return valid && !valid(v.value) ? null : { atMs: v.atMs, value: v.value as T }
  } catch {
    return null
  }
}

export function store<T>(key: string, value: T, atMs: number): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify({ atMs, value } satisfies Stored<T>))
  } catch {
    // storage full or blocked: the value is read again next time
  }
}
