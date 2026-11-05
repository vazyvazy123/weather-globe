import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CITIES } from "../data/cities"
import { completionOf, fold, mergeHits, searchLocal, type PlaceHit } from "../data/places"
import { usePlaceSearch } from "./usePlaceSearch"

// The place search at the top left. As you type, the places that fit drop down — the globe's own cities and countries
// at once, any other town or region on Earth a moment later — and the best one's name is completed in place, in grey
// after what you typed: Tab or → takes it. ↑ and ↓ move through the list, Enter goes to the place, Esc closes the list
// (or, closed, clears the box). "/" anywhere outside a text field comes here.

/** past this many letters the completion is not drawn (the box would scroll under it) */
const GHOST_MAX = 26

const keyOf = (h: PlaceHit): string => (h.kind === "city" ? `c:${h.id}` : h.kind === "country" ? `n:${h.code}` : `p:${h.key}`)

/** the name with what was typed picked out, where it fits */
function Marked({ name, query }: { name: string; query: string }) {
  const q = fold(query), at = q ? fold(name).indexOf(q) : -1
  // folding keeps a precomposed name's length, so the place found is the place in the name
  if (at < 0 || fold(name).length !== name.length) return <>{name}</>
  return <>{name.slice(0, at)}<mark>{name.slice(at, at + q.length)}</mark>{name.slice(at + q.length)}</>
}

const Glass = () => (
  <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4 14 14" /></svg>
)

export function SearchBox({ onPick }: { onPick: (hit: PlaceHit) => void }) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  // the place marked in the list, by its key: the places found farther away arrive a moment later and may move it
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const local = useMemo(() => searchLocal(text, CITIES), [text])
  // places beyond the list are asked for only while it is open (not for the name a pick leaves in the box)
  const remote = usePlaceSearch(open ? text : "")
  const hits = useMemo(() => mergeHits(local, remote), [local, remote])
  const listed = open && hits.length > 0
  const active = Math.max(0, activeKey == null ? 0 : hits.findIndex((h) => keyOf(h) === activeKey))
  const ghost = open && active === 0 && text.length <= GHOST_MAX ? completionOf(text, hits[0]) : ""

  useEffect(() => setActiveKey(null), [text])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const pick = (hit: PlaceHit | undefined) => {
    if (!hit) return
    setText(hit.name)
    setOpen(false)
    inputRef.current?.blur()
    onPick(hit)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget, atEnd = el.selectionStart === text.length && el.selectionEnd === text.length
    const n = hits.length
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setOpen(true); if (n) setActiveKey(keyOf(hits[listed ? (active + 1) % n : 0])); break
      case "ArrowUp": e.preventDefault(); setOpen(true); if (n) setActiveKey(keyOf(hits[listed ? (active - 1 + n) % n : n - 1])); break
      // with the list closed (Esc), Enter opens it again rather than going somewhere unseen
      case "Enter": e.preventDefault(); if (listed) pick(hits[active]); else setOpen(true); break
      case "Escape":
        if (listed) setOpen(false)
        else { setText(""); el.blur() }
        break
      case "Tab":
      case "ArrowRight":
        if (ghost && atEnd) { e.preventDefault(); setText(text + ghost) }
        break
    }
  }

  return (
    <div className={`search${listed ? " open" : ""}`}>
      <Glass />
      <div className="search-field">
        <span className="search-ghost" aria-hidden="true"><span className="typed">{text}</span>{ghost}</span>
        <input ref={inputRef} type="text" value={text} placeholder="Search places" aria-label="Search places" spellCheck={false} autoComplete="off"
          enterKeyHint="go" role="combobox" aria-expanded={listed} aria-controls={listId} aria-autocomplete="both"
          aria-activedescendant={listed ? `${listId}-${active}` : undefined}
          onChange={(e) => { setText(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </div>
      <ul id={listId} role="listbox" aria-label="Places" className="search-list" hidden={!listed}>
        {listed && hits.map((h, k) => (
          <li key={keyOf(h)} id={`${listId}-${k}`} role="option" aria-selected={k === active}
            onMouseDown={(e) => { e.preventDefault(); pick(h) }} onMouseEnter={() => setActiveKey(keyOf(h))}>
            <span className={`kind ${h.kind}`} aria-hidden="true">{h.kind === "country" ? "◍" : h.kind === "city" ? "●" : "⌖"}</span>
            <span className="name"><Marked name={h.name} query={text} /></span>
            {h.kind === "city" && h.music && <span className="note" aria-label="has music">♪</span>}
            <span className="detail">{h.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
