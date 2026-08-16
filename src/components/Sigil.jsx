// Faceplate marks — one per box, drawn as a watermark behind the sequencer.
// All four use `currentColor`, so they pick up the box's accent.

function Tetractys() {
  const dots = []
  for (let row = 0; row < 4; row++) {
    const n = row + 1
    for (let i = 0; i < n; i++) {
      dots.push(
        <circle key={`${row}-${i}`} cx={60 + (i - (n - 1) / 2) * 22} cy={22 + row * 26} r="5" />
      )
    }
  }
  return <g fill="currentColor">{dots}</g>
}

function Gnomon() {
  const pt = (deg, r = 46) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${60 + r * Math.cos(rad)},${60 + r * Math.sin(rad)}`
  }
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="60" cy="60" r="46" />
      <polygon points={`${pt(45)} ${pt(135)} ${pt(225)} ${pt(315)}`} />
      <polygon points={`${pt(0)} ${pt(120)} ${pt(240)}`} strokeWidth="1.6" opacity="0.7" />
      {/* the gnomon itself: the L that remains when a square is taken from a square */}
      <path d="M 60 60 L 60 14 M 60 60 L 106 60" strokeWidth="1.6" opacity="0.7" />
    </g>
  )
}

function Monochord() {
  // The string, its bridge positions, and the ratios they sound.
  const x0 = 14
  const x1 = 106
  const span = x1 - x0
  const stops = [1 / 2, 2 / 3, 3 / 4]
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1={x0} y1="82" x2={x1} y2="82" />
      <line x1={x0} y1="70" x2={x0} y2="94" />
      <line x1={x1} y1="70" x2={x1} y2="94" />
      {stops.map((s, i) => {
        const x = x0 + span * s
        return (
          <g key={s}>
            <line x1={x} y1="74" x2={x} y2="90" strokeWidth="1.6" opacity="0.8" />
            <path
              d={`M ${x0} 66 Q ${(x0 + x) / 2} ${44 - i * 12} ${x} 66`}
              strokeWidth="1.4"
              opacity={0.65 - i * 0.15}
            />
          </g>
        )
      })}
    </g>
  )
}

function Orrery() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="60" cy="60" rx="50" ry="20" />
      <ellipse cx="60" cy="60" rx="36" ry="36" strokeWidth="1.5" opacity="0.75" />
      <ellipse cx="60" cy="60" rx="20" ry="46" strokeWidth="1.5" opacity="0.6" />
      <g fill="currentColor" stroke="none">
        <circle cx="60" cy="60" r="6" />
        <circle cx="110" cy="60" r="3.5" />
        <circle cx="60" cy="24" r="3" opacity="0.8" />
        <circle cx="40" cy="97" r="2.5" opacity="0.7" />
      </g>
    </g>
  )
}

const SIGILS = {
  arithmetic: Tetractys,
  geometry: Gnomon,
  music: Monochord,
  astronomy: Orrery,
}

export function Sigil({ boxId, className, size = 120 }) {
  const Mark = SIGILS[boxId]
  if (!Mark) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <Mark />
    </svg>
  )
}
