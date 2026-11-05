import { useEffect, useId, useRef, useState } from "react"

// The globe's sources, and what each layer shows now, kept out of the way: at the corner, one dim line of the credits the
// data's licences ask to be seen (Open-Meteo's CC BY 4.0 among them) and a small ⓘ; either opens a card with what each
// layer shows now and every source, linked. Esc or a click elsewhere closes it.

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>

export function InfoPanel({ status, showIss, showMusic }: { status: readonly string[]; showIss: boolean; showMusic: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null), buttonRef = useRef<HTMLButtonElement>(null)
  const cardId = useId()

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus() } }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc) }
  }, [open])

  return (
    <div ref={rootRef} className="info">
      <div className="info-line">
        <button type="button" className="info-credit" onClick={() => setOpen((v) => !v)} tabIndex={-1} aria-hidden="true">© NASA · NOAA · Open-Meteo · Natural Earth</button>
        <button ref={buttonRef} type="button" className={`info-button${open ? " on" : ""}`} aria-expanded={open} aria-controls={cardId}
          aria-label="About this view: what it shows and its sources" onClick={() => setOpen((v) => !v)}>i</button>
      </div>
      {/* after its button, so Tab goes on into it (it is placed above, CSS) */}
      {open && (
        <section id={cardId} className="info-card" role="dialog" aria-label="About this view">
          {status.length > 0 && (
            <>
              <h3>Now showing</h3>
              <ul className="info-status">{status.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
          <h3>Sources</h3>
          <ul className="info-sources">
            <li>Imagery: {link("https://earthdata.nasa.gov/gibs", "NASA EOSDIS GIBS")} (Blue Marble, GOES and Himawari, shaded relief)</li>
            <li>Clouds: {link("https://nowcoast.noaa.gov/", "NOAA nowCOAST")} (GMGSI infrared mosaic)</li>
            <li>Weather, wind and the place search: {link("https://open-meteo.com/", "Open-Meteo.com")} ({link("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")})</li>
            <li>Land: {link("https://www.naturalearthdata.com/", "Natural Earth")}</li>
            {showIss && <li>The ISS's orbit: {link("https://wheretheiss.at/", "wheretheiss.at")}</li>}
            {showMusic && <li>Music previews: {link("https://www.apple.com/apple-music/", "Apple Music")}; singers' photos: Deezer</li>}
          </ul>
          <p className="info-privacy">Your browser asks these services itself, so they see its address; Open-Meteo also sees what you type in
            the search, and NASA the part of the world you zoom into. The page keeps no cookies and runs no analytics.</p>
        </section>
      )}
    </div>
  )
}
