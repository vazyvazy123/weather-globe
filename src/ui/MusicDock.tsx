import { useEffect, useRef, useState } from "react"
import { youtubeSearchUrl, type Track } from "../data/music"
import { Cassette } from "./Cassette"
import type { Music, PlayStatus } from "./useMusic"

// The music player over the globe: the song's cover glowing behind a glass card, the cover itself, the singer's photo,
// where the song is from (with the weather there now), the cassette playing it, the time, and the controls. Folded, it
// is a slim bar with the cover spinning like a record. Empty, it offers a world shuffle and the song of the day.
// The previews are Apple's 30-second clips; each song links to its full version on Apple Music and YouTube.

export interface Place { id: string; name: string; country: string; temp: string | null; time: string | null }

interface Props {
  music: Music
  place: Place | null
  onClose: () => void
  /** fly the globe to the song's city */
  onFind: (cityId: string) => void
  boxRef: (el: HTMLElement | null) => void
  /** the song of the day (the ISS's pick), offered beside the world shuffle while nothing plays */
  daySong?: Track | null
}

/** the label stripes of the cassette, one pair per song (by its id) */
const STRIPES: ReadonlyArray<readonly [string, string]> = [
  ["#e4572e", "#f3a712"], ["#2e86ab", "#f18f01"], ["#c73e1d", "#3b1f2b"], ["#3bb273", "#e1bc29"], ["#7768ae", "#e15554"],
  ["#0f7173", "#f05d23"], ["#d1495b", "#edae49"], ["#00798c", "#d1495b"], ["#5b3758", "#f9b5ac"], ["#ef476f", "#ffd166"],
]
export function stripesFor(id: string | undefined): readonly [string, string] {
  if (!id) return ["#f4b942", "#e4572e"]
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return STRIPES[h % STRIPES.length]
}

/** the screens where the player starts folded (music.css lays it out full-width below this too) */
const NARROW = "(max-width: 640px)"

const clock = (s: number): string => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00")

const STATUS: Record<PlayStatus, string> = { idle: "Ready", loading: "Loading", playing: "Now playing", paused: "Paused", blocked: "Paused", error: "Skipping", unavailable: "Unavailable" }
/** what the player says when something stops the music */
const NOTES: Partial<Record<PlayStatus, string>> = {
  blocked: "The browser paused the music: press play to keep going.",
  error: "This preview did not load; trying the next song…",
  unavailable: "Songs are not loading right now: you may be offline, or this site blocks audio from Apple. Press play to try again.",
}

const I = {
  play: "M8 5.5v13l11-6.5z",
  pause: "M7 5h3.6v14H7zM13.4 5H17v14h-3.6z",
  prev: "M6 5h2.2v14H6zM20 5.6v12.8L9.4 12z",
  next: "M15.8 5H18v14h-2.2zM4 5.6v12.8L14.6 12z",
  shuffle: "M16 4l4 3.5-4 3.5V8.6h-1.4c-1.3 0-2.3.6-3 1.7l-.6.9-1.3-1.9c1-1.5 2.6-2.4 4.9-2.4H16zm0 9l4 3.5-4 3.5v-2.4h-1.4c-2.3 0-3.9-.9-5-2.6L7.6 11.9C6.9 10.8 5.9 10.2 4.6 10.2H3V8h1.6c2.3 0 3.9.9 5 2.6l2 3.1c.7 1.1 1.7 1.7 3 1.7H16zM3 16h1.6c1.3 0 2.3-.6 3-1.7l.5-.8 1.3 1.9c-1 1.4-2.6 2.3-4.8 2.3H3z",
  out: "M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14zM5 6h6v2H6v10h10v-5h2v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  fold: "M6.4 8.6L12 14.2l5.6-5.6L19 10l-7 7-7-7z",
  unfold: "M6.4 15.4L12 9.8l5.6 5.6L19 14l-7-7-7 7z",
  close: "M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4L12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z",
  volHigh: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z",
  volLow: "M5 9v6h4l5 5V4L9 9H5zm11.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12z",
  mute: "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm6.9 8h-3a14 14 0 0 0-1.3-5.4A7 7 0 0 1 18.9 11zM12 5.1c.9 1.2 1.7 3.2 1.9 5.9h-3.8c.2-2.7 1-4.7 1.9-5.9zM9.4 5.6A14 14 0 0 0 8.1 11h-3a7 7 0 0 1 4.3-5.4zM5.1 13h3a14 14 0 0 0 1.3 5.4A7 7 0 0 1 5.1 13zm6.9 5.9c-.9-1.2-1.7-3.2-1.9-5.9h3.8c-.2 2.7-1 4.7-1.9 5.9zm2.6-.5a14 14 0 0 0 1.3-5.4h3a7 7 0 0 1-4.3 5.4z",
}
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" className="ic"><path d={d} /></svg>

/** the playing position, read from the element a few times a second */
function useTime(audio: HTMLAudioElement | null, track: Track | null): { t: number; d: number } {
  const [time, setTime] = useState({ t: 0, d: 30 })
  useEffect(() => {
    if (!audio) return
    const read = () => setTime({ t: audio.currentTime || 0, d: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30 })
    read()
    for (const e of ["timeupdate", "durationchange", "seeked", "emptied"]) audio.addEventListener(e, read)
    return () => { for (const e of ["timeupdate", "durationchange", "seeked", "emptied"]) audio.removeEventListener(e, read) }
  }, [audio, track])
  return time
}

/** a picture that quietly steps aside if it cannot load (or the site's policy blocks it) */
function Pic({ src, className, alt = "" }: { src: string | null; className: string; alt?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span className={`${className} pic-none`} aria-hidden="true" />
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

/** One volume for every song: a mute button and, where the browser allows it, a slider. */
function Volume({ music }: { music: Music }) {
  const silent = music.muted || music.volume === 0
  const shown = music.muted ? 0 : music.volume
  const label = silent ? "Unmute" : "Mute"
  return (
    <div className="dock-volume">
      <button type="button" className="dock-icon small" onClick={music.toggleMute} aria-pressed={silent} aria-label={label} title={label}>
        <Icon d={silent ? I.mute : music.volume < 0.5 ? I.volLow : I.volHigh} />
      </button>
      {music.volumeAdjustable && (
        <input type="range" className="dock-range" min={0} max={1} step={0.01} value={shown} aria-label="Volume" aria-valuetext={`${Math.round(shown * 100)}%`}
          style={{ ["--p" as string]: `${shown * 100}%` }} onChange={(e) => music.setVolume(Number(e.currentTarget.value))} />
      )}
    </div>
  )
}

const Eq = ({ on }: { on: boolean }) => <span className={`eq${on ? " on" : ""}`} aria-hidden="true"><i /><i /><i /><i /></span>

export function MusicDock({ music, place, onClose, onFind, boxRef, daySong = null }: Props) {
  const { track, status, audio } = music
  // on a phone the open player would cover the song's city: it starts folded
  const [folded, setFolded] = useState(() => typeof window !== "undefined" && window.matchMedia?.(NARROW).matches === true)
  const { t, d } = useTime(audio, track)
  const playing = status === "playing"
  const stripes = stripesFor(track?.id)
  const style = { ["--s1" as string]: stripes[0], ["--s2" as string]: stripes[1] }
  const note = NOTES[status]
  // one always-present line for screen readers: the song as it changes, or what stopped it
  const said = note ?? (track ? `${track.title} by ${track.artist}${place ? `, from ${place.name}, ${place.country}` : ""}` : "")
  const announce = <span className="sr-only" role="status">{said}</span>
  // folding or opening with the keyboard keeps the focus on the button that undoes it
  const foldBtn = useRef<HTMLButtonElement>(null), openBtn = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const fold = (on: boolean) => { refocus.current = true; setFolded(on) }
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false;
    (folded ? openBtn : foldBtn).current?.focus()
  }, [folded])
  const playBtn = (
    <button type="button" className="dock-play" onClick={music.toggle} aria-label={playing ? "Pause" : "Play"}>
      <Icon d={playing ? I.pause : I.play} />
    </button>
  )

  if (folded) {
    return (
      <section ref={boxRef} className="dock folded" style={style} aria-label="Music player">
        {announce}
        <span className={`disc${playing ? " on" : ""}`}><Pic src={track?.cover ?? null} className="disc-art" /></span>
        <div className="dock-mini-meta">
          <b>{track?.title ?? "World Mixtape"}</b>
          <span>{track ? `${track.artist}${place ? ` · ${place.name}` : ""}` : "Tap a ♪ city to play"}</span>
        </div>
        {playBtn}
        <button ref={openBtn} type="button" className="dock-icon" onClick={() => fold(false)} aria-label="Open the player"><Icon d={I.unfold} /></button>
      </section>
    )
  }

  return (
    <section ref={boxRef} className="dock" style={style} aria-label="Music player">
      {announce}
      <div className="dock-glow" aria-hidden="true">{track?.cover && <Pic key={track.id} src={track.cover} className="dock-glow-img" />}</div>
      <header className="dock-top">
        <span className="dock-eyebrow">
          <Eq on={playing} />
          {STATUS[status]}
          {place && <>
            <span className="dot">·</span>
            <button type="button" className="dock-place" onClick={() => onFind(place.id)} title="Show on the globe">{place.name}, {place.country}</button>
          </>}
        </span>
        <span className="dock-actions">
          <button ref={foldBtn} type="button" className="dock-icon" onClick={() => fold(true)} aria-label="Fold the player"><Icon d={I.fold} /></button>
          <button type="button" className="dock-icon" onClick={onClose} aria-label="Stop the music and close the player"><Icon d={I.close} /></button>
        </span>
      </header>

      {track ? (
        <div className="dock-now" key={track.id}>
          <Pic src={track.cover} className="dock-cover" alt={`${track.album ?? track.title} cover`} />
          <div className="dock-meta">
            <h3 className="dock-title">{track.title}</h3>
            <p className="dock-artist"><Pic src={track.artistImage} className="dock-avatar" alt={track.artist} />{track.artist}</p>
            <p className="dock-tags">
              {track.genre && <span className="tag">{track.genre}</span>}
              {place?.temp && <span className="tag weather">{place.temp}{place.time ? ` · ${place.time}` : ""}</span>}
            </p>
          </div>
        </div>
      ) : (
        <div className="dock-now empty">
          <div className="dock-meta">
            <h3 className="dock-title">Sounds of the world</h3>
            <p className="dock-hint">Tap a glowing ♪ city for the songs people there know by heart, or let the world pick.</p>
            <button type="button" className="dock-world" onClick={music.playWorld}><Icon d={I.globe} /> Play the world</button>
            {daySong && (
              <button type="button" className="dock-world dock-day" onClick={() => music.playId(daySong.id)} title={`${daySong.title} by ${daySong.artist}, picked by the ISS`}>
                <span aria-hidden="true">☀</span> Song of the day
              </button>
            )}
          </div>
        </div>
      )}

      <div className="dock-deck"><Cassette key={track?.id ?? "blank"} track={track} audio={audio} playing={playing} accent={stripes} /></div>

      {track && (
        <div className="dock-time">
          <span>{clock(t)}</span>
          <input type="range" className="dock-range" min={0} max={d} step={0.1} value={Math.min(t, d)} aria-label="Seek"
            style={{ ["--p" as string]: `${(Math.min(t, d) / d) * 100}%` }}
            onChange={(e) => { if (audio) audio.currentTime = Number(e.currentTarget.value) }} />
          <span>{clock(d)}</span>
        </div>
      )}

      <div className="dock-controls">
        <button type="button" className={`dock-icon${music.shuffle ? " on" : ""}`} aria-pressed={music.shuffle} onClick={() => music.setShuffle(!music.shuffle)}
          aria-label="Shuffle around the world" title="Shuffle around the world"><Icon d={I.shuffle} /></button>
        <button type="button" className="dock-icon big" onClick={music.prev} aria-label="Previous song" disabled={!track}><Icon d={I.prev} /></button>
        {playBtn}
        <button type="button" className="dock-icon big" onClick={music.next} aria-label={music.shuffle ? "Another song from somewhere else" : "Next song, to the east"}><Icon d={I.next} /></button>
        {track ? (
          <a className="dock-icon" href={youtubeSearchUrl(track)} target="_blank" rel="noopener noreferrer" aria-label={`The full song on YouTube`} title="The full song on YouTube"><Icon d={I.out} /></a>
        ) : <span className="dock-icon" aria-hidden="true" />}
      </div>

      <Volume music={music} />

      {note && <p className={`dock-note${status === "blocked" ? "" : " warn"}`} aria-hidden="true">{note}</p>}
      {track && (
        <p className="dock-credit">
          30-second preview · {track.appleUrl
            ? <a href={track.appleUrl} target="_blank" rel="noopener noreferrer">Listen on Apple Music</a>
            : "Apple Music"} · <a href={youtubeSearchUrl(track)} target="_blank" rel="noopener noreferrer">YouTube</a>
        </p>
      )}
    </section>
  )
}

/** A city's songs, for its weather panel: tap one to play it. `title` names the list (null: none). */
export function SongList({ tracks, music, country, title }: { tracks: readonly Track[]; music: Music; country: string; title?: string | null }) {
  if (!tracks.length) return null
  const heading = title === undefined ? `♪ Music from ${country}` : title
  return (
    <section className="songs" aria-label={heading ?? `Music from ${country}`}>
      {heading != null && <h3>{heading}</h3>}
      <ul>
        {tracks.map((tr) => {
          const on = music.track?.id === tr.id
          return (
            <li key={tr.id}>
              <button type="button" className={`song${on ? " on" : ""}`} onClick={() => (on ? music.toggle() : music.playId(tr.id))}
                aria-label={`${on && music.status === "playing" ? "Pause" : "Play"} ${tr.title} by ${tr.artist}`}>
                <Pic src={tr.cover} className="song-art" />
                <span className="song-meta"><b>{tr.title}</b><span>{tr.artist}</span></span>
                {on && music.status === "playing" ? <Eq on /> : <Icon d={I.play} />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
