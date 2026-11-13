import { useCallback, useEffect, useRef } from "react"
import { tempColor } from "../globe/tempColor"

// The viewer's favourite cities in one place (the ★ chip in the bar opens it): each with its weather now and its local
// time, in the order they were starred. A city's row flies there and opens its card; its star takes it off the list.
// Empty, it says how a city gets here.

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

export function FavoritesPanel({ rows, onOpen, onRemove, onClose, boxRef }:
  { rows: readonly FavoriteRow[]; onOpen: (id: string) => void; onRemove: (id: string) => void; onClose: () => void; boxRef: (el: HTMLElement | null) => void }) {
  // a city taken off the list hands the keyboard's focus to the next one's star (or, none left, to Close)
  const own = useRef<HTMLElement | null>(null)
  const ref = useCallback((el: HTMLElement | null) => { own.current = el; boxRef(el) }, [boxRef])
  const focusAfter = useRef<number | null>(null)
  useEffect(() => {
    const i = focusAfter.current
    if (i == null) return
    focusAfter.current = null
    const stars = own.current?.querySelectorAll<HTMLButtonElement>(".fav-remove")
    ;(stars?.[Math.min(i, stars.length - 1)] ?? own.current?.querySelector<HTMLButtonElement>(".close"))?.focus()
  }, [rows.length])
  return (
    <aside ref={ref} className="panel fav-panel" aria-label="Your favorite cities">
      <button type="button" className="close" aria-label="Close" onClick={onClose}>×</button>
      <h2>Your favorites</h2>
      <p className="dim country">{rows.length ? `${rows.length} ${rows.length === 1 ? "city" : "cities"} · kept in this browser` : "Kept in this browser"}</p>
      {rows.length === 0 ? (
        <p className="fav-empty">No favorites yet. Open any city and tap <span className="fav-glyph">☆</span> beside its name: it will always show
          on the globe, and be listed here.</p>
      ) : (
        <ul className="fav-list">
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
                onClick={() => { focusAfter.current = i; onRemove(r.id) }}>★</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
