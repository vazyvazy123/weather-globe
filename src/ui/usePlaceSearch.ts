import { useEffect, useRef, useState } from "react"
import { geocode } from "../data/geocode"
import { fold, type PlaceHit } from "../data/places"

// The places beyond the globe's own list for what is being typed (geocode.ts): asked for once the typing pauses
// DEBOUNCE_MS, for MIN_CHARS letters or more, and remembered for the visit, so the same words are never asked twice; a
// question overtaken by more typing is dropped. Until the new answer comes, the last one's places that still fit stay.

const DEBOUNCE_MS = 250
const MIN_CHARS = 2
/** the answers kept, the oldest forgotten first */
const MEMORY = 60
const answers = new Map<string, PlaceHit[]>()

function remember(q: string, hits: PlaceHit[]): void {
  answers.set(q, hits)
  if (answers.size > MEMORY) answers.delete(answers.keys().next().value as string)
}

export function usePlaceSearch(query: string): PlaceHit[] {
  const q = fold(query)
  const raw = useRef(query)
  raw.current = query
  const [found, setFound] = useState<{ q: string; hits: PlaceHit[] }>({ q: "", hits: [] })
  useEffect(() => {
    if (q.length < MIN_CHARS) return
    const held = answers.get(q)
    if (held) { setFound({ q, hits: held }); return }
    const ctl = new AbortController()
    const id = window.setTimeout(() => {
      geocode(raw.current.trim(), ctl.signal).then(
        (hits) => { remember(q, hits); setFound({ q, hits }) },
        // a failed search leaves the globe's own places to stand alone; the next words ask again
        () => { if (!ctl.signal.aborted) setFound({ q, hits: [] }) },
      )
    }, DEBOUNCE_MS)
    return () => { window.clearTimeout(id); ctl.abort() }
  }, [q])
  if (q.length < MIN_CHARS) return []
  return found.q === q ? found.hits : found.hits.filter((h) => fold(h.name).includes(q))
}
