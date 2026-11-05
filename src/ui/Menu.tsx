import { useEffect, useId, useRef, useState, type ReactNode } from "react"

// A small menu behind a toolbar chip. The chip opens it (and says so: aria-haspopup, aria-expanded); its items take
// ↑ ↓ Home End, and Enter or Space (or a click) chooses one — a checkbox item stays open for the next, any other closes
// the menu. Esc, Tab or a click elsewhere closes it, Esc giving the focus back to the chip.

export interface MenuItem {
  key: string
  label: ReactNode
  /** a checkbox item: on or off */
  checked?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** `align`: the side of its chip the list lines up with ("start" for a chip at the start of a row, so the list stays on screen) */
export function Menu({ label, items, title, active = false, align = "end" }:
  { label: ReactNode; items: readonly MenuItem[]; title?: string; active?: boolean; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null), buttonRef = useRef<HTMLButtonElement>(null), listRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const itemsOf = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? [])]

  useEffect(() => {
    if (!open) return
    // the first item (or the first one on) takes the focus
    const all = itemsOf()
    ;(all.find((b) => b.getAttribute("aria-checked") === "true") ?? all[0])?.focus()
    const away = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = itemsOf(), at = all.indexOf(document.activeElement as HTMLButtonElement)
    const go = (k: number) => { e.preventDefault(); all[(k + all.length) % all.length]?.focus() }
    switch (e.key) {
      case "ArrowDown": go(at + 1); break
      case "ArrowUp": go(at - 1); break
      case "Home": go(0); break
      case "End": go(all.length - 1); break
      case "Escape": e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break
      case "Tab": setOpen(false); break
    }
  }

  return (
    <div ref={rootRef} className="menu">
      <button ref={buttonRef} type="button" className={`chip menu-button${active ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        title={title} onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true) } }}>
        {label} <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={listRef} id={id} role="menu" className={`menu-list ${align}`} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button key={it.key} type="button" role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={it.checked} disabled={it.disabled}
              className="menu-item" onClick={() => { it.onSelect(); if (it.checked === undefined) { setOpen(false); buttonRef.current?.focus() } }}>
              {it.checked !== undefined && <span className={`tick${it.checked ? " on" : ""}`} aria-hidden="true">✓</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
