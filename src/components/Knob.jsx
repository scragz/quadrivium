import { useRef, useCallback, useMemo } from 'react'
import { paramToNorm, normToParam } from '../boxes/definitions.js'

// Pixels of vertical drag for the full 0→1 sweep. Shift divides this down.
const FULL_TRAVEL = 170
const FINE_DIVISOR = 6
const SWEEP = 270 // degrees, centred on 12 o'clock

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx, cy, r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.01) return ''
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`
}

/**
 * Vertical-drag rotary control driven by a param definition, so the taper
 * (linear vs exponential), step and value formatting all come from one place.
 */
export function Knob({ def, value, onChange, size = 40 }) {
  const dragging = useRef(false)

  const norm = useMemo(() => {
    const n = paramToNorm(def, value)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  }, [def, value])

  const bipolar = def.min < 0 && def.max > 0
  const angle = -SWEEP / 2 + norm * SWEEP
  const zeroAngle = bipolar ? -SWEEP / 2 + paramToNorm(def, 0) * SWEEP : -SWEEP / 2

  const beginDrag = useCallback((clientY, shiftKey, moveEvent, endEvent, getPoint) => {
    dragging.current = true
    const startY = clientY
    const startNorm = paramToNorm(def, value)

    const onMove = (e) => {
      if (!dragging.current) return
      const p = getPoint(e)
      if (!p) return
      if (e.cancelable) e.preventDefault()
      const travel = (p.shiftKey ?? shiftKey) ? FULL_TRAVEL * FINE_DIVISOR : FULL_TRAVEL
      const next = startNorm + (startY - p.clientY) / travel
      onChange(normToParam(def, next))
    }

    const onEnd = () => {
      dragging.current = false
      window.removeEventListener(moveEvent, onMove)
      window.removeEventListener(endEvent, onEnd)
    }

    window.addEventListener(moveEvent, onMove, { passive: false })
    window.addEventListener(endEvent, onEnd)
  }, [def, value, onChange])

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    beginDrag(e.clientY, e.shiftKey, 'mousemove', 'mouseup', (me) => me)
  }, [beginDrag])

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0]
    if (!t) return
    beginDrag(t.clientY, false, 'touchmove', 'touchend', (te) => te.touches[0])
  }, [beginDrag])

  const onDoubleClick = useCallback(() => onChange(def.def), [def, onChange])

  const onKeyDown = useCallback((e) => {
    const step = e.shiftKey ? 0.005 : 0.025
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(normToParam(def, paramToNorm(def, value) + step))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(normToParam(def, paramToNorm(def, value) - step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(def.def)
    }
  }, [def, value, onChange])

  const cx = size / 2
  const r = size / 2 - 3.5
  const display = def.format ? def.format(value) : value.toFixed(2)

  return (
    <div className="knob-wrap" style={{ width: size + 14 }}>
      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        aria-valuetext={`${display}${def.unit ?? ''}`}
        title={`${def.label}: ${display}${def.unit ?? ''} — drag to set, shift for fine, double-click to reset`}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="knob-svg">
          <path
            d={arcPath(cx, cx, r, -SWEEP / 2, SWEEP / 2)}
            className="knob-track"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={arcPath(cx, cx, r, zeroAngle, angle)}
            className="knob-fill"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cx} r={r - 4} className="knob-cap" />
          <line
            x1={cx}
            y1={cx}
            x2={polar(cx, cx, r - 4.5, angle)[0]}
            y2={polar(cx, cx, r - 4.5, angle)[1]}
            className="knob-pointer"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="knob-label">{def.label}</span>
      <span className="knob-value">
        {display}
        {def.unit ? <em>{def.unit}</em> : null}
      </span>
    </div>
  )
}
