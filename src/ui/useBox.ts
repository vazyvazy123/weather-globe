import { useCallback, useEffect, useRef, useState } from "react"
import type { LabelBox } from "../globe/labels"

/** The box an overlay takes over the stage (its offset parent), in CSS pixels, kept current as it or the window
 *  resizes; null while it is not shown. Attach the returned callback as the element's ref. */
export function useBox(): [(el: HTMLElement | null) => void, LabelBox | null] {
  const [box, setBox] = useState<LabelBox | null>(null)
  const el = useRef<HTMLElement | null>(null)
  const ro = useRef<ResizeObserver | null>(null)
  const measure = useCallback(() => {
    const e = el.current
    if (!e) { setBox(null); return }
    const next: LabelBox = [e.offsetLeft, e.offsetTop, e.offsetLeft + e.offsetWidth, e.offsetTop + e.offsetHeight]
    setBox((b) => (b && b.every((v, i) => v === next[i]) ? b : next))
  }, [])
  const ref = useCallback((node: HTMLElement | null) => {
    ro.current?.disconnect()
    ro.current = null
    el.current = node
    measure()
    if (node && typeof ResizeObserver !== "undefined") { ro.current = new ResizeObserver(measure); ro.current.observe(node) }
  }, [measure])
  useEffect(() => {
    window.addEventListener("resize", measure)
    return () => { window.removeEventListener("resize", measure); ro.current?.disconnect() }
  }, [measure])
  return [ref, box]
}
