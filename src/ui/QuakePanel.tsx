import { useCallback, useEffect, useRef } from "react"
import { quakeAgo, quakeClass, type Quake } from "../data/quakes"
import { QUAKE_AGES } from "../globe/quakeView"

// An earthquake's card (its ring tapped on the globe, or picked from the keyboard's list): how strong, where, how long
// ago and how deep, as the USGS reports it, with a link to its page there; the rings' colours by age; and the strongest
// quakes as buttons, for the keyboard and screen readers (the rings themselves are drawn, not focusable).

type Unit = "C" | "F"
const KM_PER_MI = 1.609344
const TSUNAMI_GOV = "https://www.tsunami.gov/"
const KEYS_MAX = 8

const when = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC"
const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>

/** `focusOnOpen`: opened from the keyboard, the card takes the focus (and its label is read out) */
export function QuakePanel({ quake, unit, now, onClose, boxRef, focusOnOpen = false }:
  { quake: Quake; unit: Unit; now: number; onClose: () => void; boxRef: (el: HTMLElement | null) => void; focusOnOpen?: boolean }) {
  const mi = unit === "F"
  const depth = Math.round(mi ? quake.depthKm / KM_PER_MI : quake.depthKm).toLocaleString("en")
  const mag = quake.mag.toFixed(1)
  const own = useRef<HTMLElement | null>(null)
  // one ref for both, kept the same across renders: a new one each render would detach and measure the card afresh, and
  // the measuring would render it again, without end
  const ref = useCallback((el: HTMLElement | null) => { own.current = el; boxRef(el) }, [boxRef])
  useEffect(() => { if (focusOnOpen) own.current?.focus() }, [quake.id, focusOnOpen])
  return (
    <aside ref={ref} tabIndex={-1} className="panel quake-panel" aria-label={`Magnitude ${mag} earthquake`}>
      <button type="button" className="close" aria-label="Close" onClick={onClose}>×</button>
      <h2>{quakeClass(quake.mag)} earthquake</h2>
      {quake.place && <p className="dim country">{quake.place}</p>}
      <p className="big">M {mag}</p>
      <p>{quakeAgo(quake.timeMs, now)} · {when(quake.timeMs)}</p>
      <p className="dim">{depth} {mi ? "mi" : "km"} deep · {quake.lat.toFixed(2)}°, {quake.lon.toFixed(2)}°</p>
      {quake.felt != null && quake.felt > 0 && (
        <p className="dim">Felt by {quake.felt.toLocaleString("en")} {quake.felt === 1 ? "person" : "people"} who told the USGS</p>
      )}
      {quake.tsunami && <p className="quake-tsunami">A large quake at sea: see {link(TSUNAMI_GOV, "tsunami.gov")} for any warning.</p>}
      {quake.url && <p className="quake-link">{link(quake.url, "Its page on the USGS site ↗")}</p>}
    </aside>
  )
}

/** The rings' colours, beside the wind's scale: newest first. */
export function QuakeLegend() {
  return (
    <span className="quake-legend" role="img" aria-label="Earthquake rings, sized by magnitude: red in the past hour, orange in the past day, gold over the week">
      <span className="quake-legend-name">Quakes</span>
      {QUAKE_AGES.map((a) => (
        <span key={a.label} className="quake-age"><i style={{ background: `rgb(${a.rgb})` }} />{a.label.replace("past ", "")}</span>
      ))}
    </span>
  )
}

/** The strongest quakes, each a button that opens its card: hidden until the keyboard reaches it. */
export function QuakeKeys({ quakes, now, onPick }: { quakes: readonly Quake[]; now: number; onPick: (id: string) => void }) {
  if (quakes.length === 0) return null
  return (
    <nav className="quake-keys" aria-label="The strongest earthquakes this week">
      {quakes.slice(-KEYS_MAX).reverse().map((q) => (
        <button key={q.id} type="button" data-quake={q.id} onClick={() => onPick(q.id)}>
          M {q.mag.toFixed(1)}{q.place ? ` · ${q.place}` : ""} · {quakeAgo(q.timeMs, now)}
        </button>
      ))}
    </nav>
  )
}
