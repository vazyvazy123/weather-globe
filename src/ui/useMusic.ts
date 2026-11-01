import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { nextShuffle, SHUFFLE_MEMORY, type Track } from "../data/music"

// The music: one <audio> element playing the songs' 30-second previews in `order` (west to east) or in shuffle, a song
// ending moving on to the next. The audio element lives outside React; React hears only when the song or its state
// changes (the player reads the time straight from the element, so the page does not re-render as it plays).
//  - A browser may refuse to start a song without a click (autoplay rules): the state becomes "blocked" and the play
//    button continues;
//  - a preview that fails to load is skipped, at most MAX_SKIPS in a row; past that the state is "unavailable" (offline,
//    or the site's policy blocks the audio) and the play button tries the song again;
//  - the operating system's media keys and lock screen show the song (Media Session).

export type PlayStatus = "idle" | "loading" | "playing" | "paused" | "blocked" | "error" | "unavailable"

export interface Music {
  track: Track | null
  status: PlayStatus
  shuffle: boolean
  /** the element itself, for the time; null where audio is unavailable */
  audio: HTMLAudioElement | null
  playId: (id: string) => void
  /** shuffle on, from a random song */
  playWorld: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  stop: () => void
  setShuffle: (on: boolean) => void
}

const MAX_SKIPS = 3
const SKIP_AFTER_MS = 1200
/** "previous" restarts the song once this far in */
const RESTART_AFTER_S = 3
const HISTORY = 50

/** a play() the browser held back for want of a click (other failures arrive as the element's error event) */
const notAllowed = (err: unknown): boolean => err instanceof DOMException && err.name === "NotAllowedError"

export function useMusic(order: readonly Track[]): Music {
  const audio = useMemo(() => (typeof Audio === "undefined" ? null : Object.assign(new Audio(), { preload: "auto" })), [])
  const [index, setIndex] = useState<number | null>(null)
  const [status, setStatus] = useState<PlayStatus>("idle")
  const [shuffle, setShuffleState] = useState(false)
  const at = useRef<number | null>(null)
  const shuffleRef = useRef(false)
  /** the songs played, newest last: "previous" walks back through them, shuffle avoids the latest */
  const history = useRef<number[]>([])
  /** failed songs skipped in a row, and the pending skip past the latest */
  const skips = useRef(0)
  const skipTimer = useRef<number | undefined>(undefined)

  const resume = useCallback((i: number) => {
    audio?.play().catch((err: unknown) => { if (at.current === i && notAllowed(err)) setStatus("blocked") })
  }, [audio])

  const start = useCallback((i: number) => {
    if (!audio || !order[i]) return
    window.clearTimeout(skipTimer.current)
    at.current = i
    setIndex(i)
    setStatus("loading")
    audio.src = order[i].preview
    resume(i)
  }, [audio, order, resume])

  const go = useCallback((i: number) => {
    if (at.current != null) history.current = [...history.current, at.current].slice(-HISTORY)
    start(i)
  }, [start])

  /** on to the next song: the next to the east, or another country in shuffle */
  const advance = useCallback(() => {
    const n = order.length
    if (!n) return
    const cur = at.current
    if (cur == null) { go(shuffleRef.current ? Math.floor(Math.random() * n) : 0); return }
    go(shuffleRef.current ? nextShuffle(order, cur, history.current.slice(-SHUFFLE_MEMORY), Math.random) : (cur + 1) % n)
  }, [order, go])

  // what the listener asks for starts afresh: earlier failures no longer count against the skips
  const next = useCallback(() => { skips.current = 0; advance() }, [advance])

  const prev = useCallback(() => {
    const n = order.length, cur = at.current
    if (!n || cur == null || !audio) return
    skips.current = 0
    if (audio.currentTime > RESTART_AFTER_S && !audio.error) { audio.currentTime = 0; return }
    const back = history.current.at(-1)
    if (back != null) { history.current = history.current.slice(0, -1); start(back); return }
    start((cur - 1 + n) % n)
  }, [order, audio, start])

  const playId = useCallback((id: string) => {
    const i = order.findIndex((t) => t.id === id)
    if (i < 0) return
    skips.current = 0
    if (i === at.current && audio && !audio.error) { resume(i); return }
    if (i === at.current) start(i)
    else go(i)
  }, [order, audio, go, start, resume])

  const setShuffle = useCallback((on: boolean) => { shuffleRef.current = on; setShuffleState(on) }, [])
  const playWorld = useCallback(() => {
    skips.current = 0
    setShuffle(true)
    go(Math.floor(Math.random() * Math.max(1, order.length)))
  }, [setShuffle, go, order.length])

  const toggle = useCallback(() => {
    if (!audio) return
    const cur = at.current
    if (cur == null) { next(); return }
    // a song that failed to load is loaded again
    if (audio.error) { skips.current = 0; start(cur); return }
    if (audio.paused) resume(cur)
    else audio.pause()
  }, [audio, next, start, resume])

  const stop = useCallback(() => {
    if (!audio) return
    window.clearTimeout(skipTimer.current)
    audio.pause()
    audio.removeAttribute("src")
    audio.load()
    at.current = null
    history.current = []
    skips.current = 0
    setIndex(null)
    setStatus("idle")
  }, [audio])

  // the element's own events say what it is doing
  const advanceRef = useRef(advance)
  advanceRef.current = advance
  useEffect(() => {
    if (!audio) return
    const on: Record<string, () => void> = {
      playing: () => { skips.current = 0; setStatus("playing") },
      pause: () => { if (!audio.ended && at.current != null && !audio.error) setStatus("paused") },
      waiting: () => setStatus("loading"),
      ended: () => advanceRef.current(),
      error: () => {
        const failed = at.current
        if (failed == null || !audio.getAttribute("src")) return
        if (skips.current++ >= MAX_SKIPS) { setStatus("unavailable"); return }
        setStatus("error")
        window.clearTimeout(skipTimer.current)
        // skipped only if the listener has not moved on meanwhile
        skipTimer.current = window.setTimeout(() => { if (at.current === failed) advanceRef.current() }, SKIP_AFTER_MS)
      },
    }
    for (const [name, fn] of Object.entries(on)) audio.addEventListener(name, fn)
    return () => {
      window.clearTimeout(skipTimer.current)
      for (const [name, fn] of Object.entries(on)) audio.removeEventListener(name, fn)
      audio.pause()
    }
  }, [audio])

  const track = index != null ? order[index] ?? null : null

  // the operating system's media controls
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined
    if (!ms || typeof MediaMetadata === "undefined") return
    ms.metadata = track ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album ?? "", artwork: track.cover ? [{ src: track.cover, sizes: "600x600", type: "image/jpeg" }] : [] }) : null
  }, [track])
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined
    if (!ms) return
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => toggle()], ["pause", () => audio?.pause()], ["nexttrack", () => next()], ["previoustrack", () => prev()], ["stop", () => stop()],
    ]
    for (const [action, fn] of handlers) { try { ms.setActionHandler(action, fn) } catch { /* not supported here */ } }
    return () => { for (const [action] of handlers) { try { ms.setActionHandler(action, null) } catch { /* not supported here */ } } }
  }, [audio, toggle, next, prev, stop])

  return { track, status, shuffle, audio, playId, playWorld, toggle, next, prev, stop, setShuffle }
}
