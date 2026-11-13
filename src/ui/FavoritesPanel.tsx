import { useCallback, useEffect, useRef } from "react"
import type { Track } from "../data/music"
import { tempColor } from "../globe/tempColor"
import { HEART_ON, SongButton } from "./MusicDock"
import type { Music } from "./useMusic"

// The viewer's favourites in one place (the ★ chip in the bar opens it): the cities starred, each with its weather now
// and its local time, then the songs hearted, each with its cover, its singer and its city; both in the order they were
// added. A city's row flies there and opens its card; a song's plays it (the player then flies the globe to its city),
// or, playing, pauses it. A city's star or a song's heart takes it off the list. An empty list says how one gets here.

export interface FavoriteRow {
  id: string
  name: string
  country: string
  /** the temperature as shown (°F or °C), and in °F for its colour; null before the weather is read */
  temp: string | null
  tempF: number | null
  sky: string
  localTime: string | null
}

/** a favourite song, with the city it stands on and that city's country */
export interface FavoriteSongRow { track: Track; city: string; country: string }

/** the two lists (by their class): a favourite taken off one hands the focus on within it */
type List = "fav-cities" | "fav-songs"
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function FavoritesPanel({ rows, songs, music, onOpen, onRemove, onRemoveSong, onClose, boxRef }: {
  rows: readonly FavoriteRow[]; songs: readonly FavoriteSongRow[]; music: Music; onOpen: (id: string) => void; onRemove: (id: string) => void
  onRemoveSong: (id: string) => void; onClose: () => void; boxRef: (el: HTMLElement | null) => void
}) {
  // a favourite taken off its list hands the keyboard's focus to the next one's star or heart (or, none left, to Close)
  const own = useRef<HTMLElement | null>(null)
  const ref = useCallback((el: HTMLElement | null) => { own.current = el; boxRef(el) }, [boxRef])
  const focusAfter = useRef<{ list: List; i: number } | null>(null)
  useEffect(() => {
    const after = focusAfter.current
    if (!after) return
    focusAfter.current = null
    const marks = own.current?.querySelectorAll<HTMLButtonElement>(`.${after.list} .fav-remove`)
    ;(marks?.[Math.min(after.i, marks.length - 1)] ?? own.current?.querySelector<HTMLButtonElement>(".close"))?.focus()
  }, [rows.length, songs.length])
  const kept = [rows.length ? count(rows.length, "city", "cities") : null, songs.length ? count(songs.length, "song", "songs") : null].filter((s): s is string => s != null)
  return (
    <aside ref={ref} className="panel fav-panel" aria-label="Your favorites">
      <button type="button" className="close" aria-label="Close" onClick={onClose}>×</button>
      <h2>Your favorites</h2>
      <p className="dim country">{kept.length ? `${kept.join(" · ")} · kept in this browser` : "Kept in this browser"}</p>
      <section className="fav-section">
        <h3>Cities</h3>
        {rows.length === 0 ? (
          <p className="fav-empty">No favorite cities yet. Open any city and tap <span className="fav-glyph">☆</span> beside its name: it will always show
            on the globe, and be listed here.</p>
        ) : (
          <ul className="fav-list fav-cities">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="fav-row" onClick={() => onOpen(r.id)}
                  aria-label={`${r.name}, ${r.country}${r.temp ? `, ${r.temp}` : ""}${r.sky ? `, ${r.sky}` : ""}${r.localTime ? `, local time ${r.localTime}` : ""}`}>
                  <span className="fav-where">
                    <span className="fav-name">{r.name}</span>
                    <span className="fav-meta">{r.country}{r.localTime ? ` · ${r.localTime}` : ""}</span>
                  </span>
                  <span className="fav-now">
                    {r.temp && <span className="fav-temp" style={{ ["--tc" as string]: r.tempF != null ? tempColor(r.tempF) : undefined }}>{r.temp}</span>}
                    <span className="fav-sky">{r.sky}</span>
                  </span>
                </button>
                <button type="button" className="fav-remove" aria-label={`Remove ${r.name} from favorites`} title="Remove from favorites"
                  onClick={() => { focusAfter.current = { list: "fav-cities", i }; onRemove(r.id) }}>★</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="fav-section">
        <h3>Songs</h3>
        {songs.length === 0 ? (
          <p className="fav-empty">No favorite songs yet. Tap <span className="fav-glyph">♡</span> beside a song, in a ♪ city's card or in the player: it
            will be listed here, to play again.</p>
        ) : (
          <ul className="fav-list fav-songs">
            {songs.map(({ track, city, country }, i) => (
              <li key={track.id}>
                <SongButton track={track} music={music} sub={`${track.artist} · ${city}`} where={`, from ${city}, ${country}`} />
                <button type="button" className="fav-remove" aria-label={`Remove ${track.title} by ${track.artist} from favorites`} title="Remove from favorites"
                  onClick={() => { focusAfter.current = { list: "fav-songs", i }; onRemoveSong(track.id) }}>{HEART_ON}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
