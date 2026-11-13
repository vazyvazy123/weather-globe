import { useCallback, useEffect, useMemo, useState } from "react"
import { readFavorites, toggleFavorite } from "../data/favorites"

// One list of the viewer's favourites (the cities starred, or the songs hearted; favorites.ts), kept in this browser's
// localStorage under its own key: read back once, written again as it changes, and changed with it in this browser's
// other tabs. Where the browser keeps nothing (private modes may refuse), the list lasts this visit only. `known` is a
// set made once (a new one each render would hang a new listener on every render).

export interface Favorites {
  /** the ids, in the order they were added */
  ids: readonly string[]
  /** the most the list keeps */
  max: number
  /** `id` added at the end, or taken out where it is in the list (none added past `max`) */
  toggle: (id: string) => void
}

export function useFavorites(key: string, known: ReadonlySet<string>, max: number): Favorites {
  const [ids, setIds] = useState((): string[] => { try { return readFavorites(globalThis.localStorage?.getItem(key) ?? null, known, max) } catch { return [] } })
  const toggle = useCallback((id: string) => setIds((list) => toggleFavorite(list, id, max)), [max])
  useEffect(() => {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(ids)) } catch { /* the favourites last this visit only */ }
  }, [key, ids])
  // favourites changed in another tab of this browser come here too
  useEffect(() => {
    const changed = (e: StorageEvent) => { if (e.key === key) setIds(readFavorites(e.newValue, known, max)) }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [key, known, max])
  return useMemo(() => ({ ids, max, toggle }), [ids, max, toggle])
}
