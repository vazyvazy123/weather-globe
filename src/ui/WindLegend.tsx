// The wind's speed scale beside its caption: the trails' colours from calm to a gale (windGl.ts's palette), marked in the
// unit that goes with the temperatures (km/h with °C, mph with °F).

type Unit = "C" | "F"
/** the scale's top, m/s (the palette's last colour is reached at 32) */
const TOP_MS = 34
const SCALES: Record<Unit, { perMs: number; name: string; ticks: readonly number[] }> = {
  C: { perMs: 3.6, name: "km/h", ticks: [0, 40, 80, 120] },
  F: { perMs: 2.23694, name: "mph", ticks: [0, 25, 50, 75] },
}

export function WindLegend({ unit }: { unit: Unit }) {
  const s = SCALES[unit]
  return (
    <span className="wind-legend" role="img" aria-label={`Wind speed colours: from calm to ${s.ticks[s.ticks.length - 1]} ${s.name} and more`}>
      <span className="wind-scale">
        {s.ticks.map((v) => <span key={v} className="tick" style={{ left: `${((v / s.perMs) / TOP_MS) * 100}%` }}>{v}</span>)}
      </span>
      <span className="unit">{s.name}</span>
    </span>
  )
}
