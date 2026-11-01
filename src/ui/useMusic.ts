import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { nextShuffle, SHUFFLE_MEMORY, type Track } from "../data/music"

// The music: one <audio> element playing the songs' 30-second previews in `order` (west to east) or in shuffle, a song
// ending moving on to the next. The audio element lives outside React; React hears only when the song or its state
// changes (the player reads the time straight from the element, so the page does not re-render as it plays).
//  - A browser may refuse to start a song without a click (autoplay rules): the state becomes "blocked" and the play
//    button continues;
//  - a preview that fails to load is skipped, at most MAX_SKIPS in a row; past that the state is "unavailable" (offline,
//    or the site's policy blocks the audio) and the play button tries the song again;
//  - the operating system's media keys and lock screen show the song (Media Session);
//  - one volume for every song, kept between visits; the slider's position is squared into the element's volume, so
//    the quiet end has room to move (hearing is logarithmic). Where the browser fixes the volume (iPhone, iPad) only
//    muting is offered.

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
  /** the volume slider's position, 0..1 */
  volume: number
  muted: boolean
  /** false where the browser does not let a page set the volume (only muting works there) */
  volumeAdjustable: boolean
  setVolume: (v: number) => void
  toggleMute: () => void
}

const MAX_SKIPS = 3
const SKIP_AFTER_MS = 1200
/** "previous" restarts the song once this far in */
const RESTART_AFTER_S = 3
const HISTORY = 50

const VOLUME_KEY = "weather-globe:volume"
export const DEFAULT_VOLUME = 0.8

/** A stored slider position, or `fallback` when there is none or it is not a number from 0 to 1. */
export function parseVolume(raw: string | null, fallback = DEFAULT_VOLUME): number {
  if (raw == null || raw.trim() === "") return fallback
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback
}

/** The element's volume for a slider position: squared, so equal steps of the slider sound like equal steps. */
export const loudness = (position: number): number => Math.max(0, Math.min(1, position)) ** 2

const readVolume = (): number => { try { return parseVolume(globalThis.localStorage?.getItem(VOLUME_KEY) ?? null) } catch { return DEFAULT_VOLUME } }

/** Whether this browser lets a page set a media element's volume (iOS keeps it at 1, for the hardware buttons). */
function canSetVolume(a: HTMLAudioElement | null): boolean {
  if (!a) return false
  const before = a.volume
  a.volume = 0.5
  const ok = Math.abs(a.volume - 0.5) < 0.01
  a.volume = before
  return ok
}

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
  const [volume, setVolumeState] = useState(readVolume)
  const [muted, setMuted] = useState(false)
  const volumeAdjustable = useMemo(() => canSetVolume(audio), [audio])

  // the one volume, for whatever song is on now or next
  useEffect(() => {
    if (!audio) return
    if (volumeAdjustable) audio.volume = loudness(volume)
    audio.muted = muted
  }, [audio, volume, muted, volumeAdjustable])
  const setVolume = useCallback((v: number) => {
    const next = Math.max(0, Math.min(1, v))
    setVolumeState(next)
    // moving the slider up speaks again
    if (next > 0) setMuted(false)
    try { globalThis.localStorage?.setItem(VOLUME_KEY, String(next)) } catch { /* the level lasts this visit only */ }
  }, [])
  // unmuting a slider left at nothing brings it back to the usual level
  const toggleMute = useCallback(() => {
    if (muted || volume === 0) { setMuted(false); if (volume === 0) setVolume(DEFAULT_VOLUME) }
    else setMuted(true)
  }, [muted, volume, setVolume])

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

  return { track, status, shuffle, audio, playId, playWorld, toggle, next, prev, stop, setShuffle, volume, muted, volumeAdjustable, setVolume, toggleMute }
}
