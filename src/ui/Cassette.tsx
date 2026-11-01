import { useEffect, useRef } from "react"
import type { Track } from "../data/music"
import { reducedMotion } from "../globe/camera"

// A compact cassette playing the song: a smoked shell, the song written on its paper label, and through the window the
// two reels — the tape winds from the left pack onto the right as the preview plays (each pack's area is the tape it
// holds, so the left shrinks as the right grows), and each hub turns at the speed a constant tape speed gives its pack
// (the smaller the pack, the faster it spins). Drawn in SVG; the reels move by animation frames only while playing.

const W = 320, H = 200
const LX = 108, RX = 212, CY = 93
/** the tape pack's radius: empty (the hub) and full */
const R_HUB = 14, R_FULL = 40
/** the tape's speed past the head, in drawing units a second */
const TAPE_PER_S = 70
const DEG = 180 / Math.PI

interface Props {
  track: Track | null
  audio: HTMLAudioElement | null
  playing: boolean
  /** the label's stripes */
  accent: readonly [string, string]
}

/** the radii of the two packs when `p` (0..1) of the tape has played */
export function packRadii(p: number): [number, number] {
  const q = Math.max(0, Math.min(1, p)), a0 = R_HUB * R_HUB, a1 = R_FULL * R_FULL
  return [Math.sqrt(a0 + (1 - q) * (a1 - a0)), Math.sqrt(a0 + q * (a1 - a0))]
}

function Hub({ x, hubRef }: { x: number; hubRef: React.RefObject<SVGGElement> }) {
  return (
    <g ref={hubRef}>
      <circle cx={x} cy={CY} r={R_HUB - 1} className="cs-hub" />
      <circle cx={x} cy={CY} r={7.5} className="cs-hub-hole" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x={x - 1.6} y={CY - 7.6} width={3.2} height={3.4} rx={0.6} className="cs-tooth" transform={`rotate(${a} ${x} ${CY})`} />
      ))}
      <circle cx={x + 9.3} cy={CY} r={1.3} className="cs-hub-mark" />
    </g>
  )
}

export function Cassette({ track, audio, playing, accent }: Props) {
  const leftPack = useRef<SVGCircleElement>(null), rightPack = useRef<SVGCircleElement>(null)
  const leftHub = useRef<SVGGElement>(null), rightHub = useRef<SVGGElement>(null)
  /** the hubs' turn (degrees), kept across a pause so they resume where they stopped */
  const angles = useRef<[number, number]>([0, 0])

  useEffect(() => {
    let raf = 0, last = performance.now()
    let [aL, aR] = angles.current
    const spin = playing && !reducedMotion()
    const paint = (now: number) => {
      const p = audio && audio.duration > 0 ? audio.currentTime / audio.duration : 0
      const [rl, rr] = packRadii(p)
      leftPack.current?.setAttribute("r", rl.toFixed(2))
      rightPack.current?.setAttribute("r", rr.toFixed(2))
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (spin) {
        aL = (aL + (TAPE_PER_S * dt / rl) * DEG) % 360
        aR = (aR + (TAPE_PER_S * dt / rr) * DEG) % 360
        angles.current = [aL, aR]
      }
      leftHub.current?.setAttribute("transform", `rotate(${aL.toFixed(2)} ${LX} ${CY})`)
      rightHub.current?.setAttribute("transform", `rotate(${aR.toFixed(2)} ${RX} ${CY})`)
    }
    const loop = (now: number) => { paint(now); raf = requestAnimationFrame(loop) }
    paint(last)
    if (spin) raf = requestAnimationFrame(loop)
    // paused, the packs still follow a seek
    const still = () => { if (!spin) paint(performance.now()) }
    audio?.addEventListener("timeupdate", still)
    audio?.addEventListener("loadedmetadata", still)
    return () => {
      cancelAnimationFrame(raf)
      audio?.removeEventListener("timeupdate", still)
      audio?.removeEventListener("loadedmetadata", still)
    }
  }, [audio, playing, track])

  const title = track?.title ?? "World Mixtape"
  const artist = track ? track.artist : "Side A · songs from everywhere"
  // a long title is pressed to fit the label
  const squeeze = title.length * 9.6 > 232
  return (
    <svg className={`cassette${playing ? " spinning" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={track ? `Cassette: ${track.title} by ${track.artist}` : "An empty cassette"}>
      <defs>
        <linearGradient id="cs-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#30344a" />
          <stop offset="1" stopColor="#15172a" />
        </linearGradient>
        <linearGradient id="cs-gloss" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cs-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf5e8" />
          <stop offset="1" stopColor="#ebe0c8" />
        </linearGradient>
        <radialGradient id="cs-tape">
          <stop offset="0.3" stopColor="#5a3826" />
          <stop offset="0.85" stopColor="#3a2318" />
          <stop offset="1" stopColor="#1f120c" />
        </radialGradient>
        <linearGradient id="cs-window" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d0f1c" stopOpacity="0.92" />
          <stop offset="1" stopColor="#1c2036" stopOpacity="0.88" />
        </linearGradient>
        <clipPath id="cs-window-clip"><rect x="56" y="66" width="208" height="54" rx="27" /></clipPath>
      </defs>

      {/* the shell */}
      <rect x="3" y="3" width={W - 6} height={H - 6} rx="14" fill="url(#cs-shell)" className="cs-edge" />
      {[[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]].map(([x, y]) => (
        <g key={`${x}-${y}`} className="cs-screw"><circle cx={x} cy={y} r="4.2" /><path d={`M${x - 2.4} ${y}h4.8M${x} ${y - 2.4}v4.8`} /></g>
      ))}

      {/* the label */}
      <rect x="24" y="14" width="272" height="122" rx="8" fill="url(#cs-paper)" />
      <rect x="24" y="96" width="272" height="9" fill={accent[0]} />
      <rect x="24" y="105" width="272" height="9" fill={accent[1]} />
      <text x="36" y="38" className="cs-title" {...(squeeze ? { textLength: 232, lengthAdjust: "spacingAndGlyphs" } : {})}>{title}</text>
      <line x1="36" y1="45" x2="270" y2="45" className="cs-rule" />
      <text x="36" y="59" className="cs-artist">{artist.toUpperCase()}</text>
      <rect x="274" y="22" width="16" height="16" rx="3" className="cs-side" />
      <text x="282" y="34.5" textAnchor="middle" className="cs-side-a">A</text>
      <text x="282" y="130" textAnchor="end" className="cs-model">C·30</text>
      <text x="38" y="130" className="cs-model">STEREO · TYPE I</text>

      {/* the window: tape packs and hubs */}
      <rect x="56" y="66" width="208" height="54" rx="27" fill="url(#cs-window)" className="cs-window" />
      <g clipPath="url(#cs-window-clip)">
        <circle ref={leftPack} cx={LX} cy={CY} r={R_FULL} fill="url(#cs-tape)" />
        <circle ref={rightPack} cx={RX} cy={CY} r={R_HUB} fill="url(#cs-tape)" />
        {[0, 1, 2, 3, 4, 5, 6].map((k) => <line key={k} x1={136 + k * 8} y1="112" x2={136 + k * 8} y2={k % 3 === 0 ? 106 : 109} className="cs-tick" />)}
      </g>
      <Hub x={LX} hubRef={leftHub} />
      <Hub x={RX} hubRef={rightHub} />
      <rect x="56" y="66" width="208" height="54" rx="27" fill="none" className="cs-window-rim" />

      {/* the head opening, with the tape running past */}
      <path d={`M72 ${H - 3} L90 150 H230 L248 ${H - 3} Z`} className="cs-head" />
      <line x1="86" y1={H - 7} x2="234" y2={H - 7} className="cs-tape-run" />
      {[112, 208].map((x) => <circle key={x} cx={x} cy="176" r="5.5" className="cs-hole" />)}
      {[146, 174].map((x) => <rect key={x} x={x - 4} y="166" width="8" height="8" rx="1.5" className="cs-hole" />)}
      <g className="cs-screw"><circle cx="160" cy="184" r="3.6" /><path d="M157.9 184h4.2M160 181.9v4.2" /></g>

      <rect x="3" y="3" width={W - 6} height={H - 6} rx="14" fill="url(#cs-gloss)" pointerEvents="none" />
    </svg>
  )
}
