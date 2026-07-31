import { useRef, useCallback, useEffect, useState } from 'react'

const BAR_HEIGHT = 80
const DRAG_THRESHOLD = 4
const STEM_MAX = 30

// Velocity → circle radius
const VELOCITY_RADIUS = { high: 8, med: 5.5, low: 3.5 }
// Velocity → touch hit bonus (smaller targets need bigger hit area)
const VELOCITY_HIT = { high: 4, med: 6, low: 8 }

function triggerColor(direction) {
  // Swell (-1) violet → Ping (+1) pale luminous
  const t = (direction + 1) / 2
  const r = Math.round(lerp(0x9a, 0xd9, t))
  const g = Math.round(lerp(0x86, 0xf2, t))
  const b = Math.round(lerp(0xe6, 0xff, t))
  return `rgb(${r},${g},${b})`
}

function lerp(a, b, t) { return a + (b - a) * t }

export function TriggerBar({ laneId, triggers, playheadPosition, onAdd, onUpdate, onDelete, onCycleVelocity }) {
  const svgRef = useRef(null)
  const [firedIds, setFiredIds] = useState(new Set())
  const prevPlayhead = useRef(playheadPosition)

  useEffect(() => {
    const prev = prevPlayhead.current
    const curr = playheadPosition

    const fired = new Set()
    triggers.forEach(t => {
      if (prev <= curr) {
        if (t.position >= prev && t.position < curr) fired.add(t.id)
      } else {
        if (t.position >= prev || t.position < curr) fired.add(t.id)
      }
    })

    prevPlayhead.current = curr

    if (fired.size > 0) {
      setFiredIds(fired)
      const timer = setTimeout(() => setFiredIds(new Set()), 200)
      return () => clearTimeout(timer)
    }
  }, [playheadPosition, triggers])

  const getSvgX = useCallback((clientX) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (clientX - rect.left) / rect.width
  }, [])

  const getTriggerAt = useCallback((clientX, clientY, extraHit = 4) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = clientX - rect.left
    const y = clientY - rect.top
    const cy = BAR_HEIGHT / 2

    for (let i = triggers.length - 1; i >= 0; i--) {
      const t = triggers[i]
      const tx = t.position * rect.width
      const r = VELOCITY_RADIUS[t.velocity ?? 'high']
      const hitR = r + extraHit + (VELOCITY_HIT[t.velocity ?? 'high'] ?? 4)
      const dist = Math.sqrt((x - tx) ** 2 + (y - cy) ** 2)
      if (dist <= hitR) return t
    }
    return null
  }, [triggers])

  const handleMouseDown = useCallback((e) => {
    if (e.button === 2) return
    e.preventDefault()

    const target = getTriggerAt(e.clientX, e.clientY)

    if (!target) {
      const pos = Math.max(0, Math.min(1, getSvgX(e.clientX)))
      const newId = onAdd(laneId, pos)

      const startY = e.clientY
      const onMove = (me) => {
        const dy = startY - me.clientY
        const direction = Math.max(-1, Math.min(1, dy / STEM_MAX))
        onUpdate(laneId, newId, { direction })
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return
    }

    // Existing trigger — move, direction-drag, or tap-to-cycle-velocity
    const startX = e.clientX
    const startY = e.clientY
    const startPos = target.position
    const startDir = target.direction
    let mode = null
    let dragged = false
    const rect = svgRef.current?.getBoundingClientRect()

    const onMove = (me) => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY

      if (!mode) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          dragged = true
          mode = Math.abs(dx) > Math.abs(dy) ? 'move' : 'direction'
        }
        return
      }

      if (mode === 'move') {
        const pos = Math.max(0, Math.min(1, startPos + dx / (rect?.width || 1)))
        onUpdate(laneId, target.id, { position: pos })
      } else {
        const direction = Math.max(-1, Math.min(1, startDir - dy / STEM_MAX))
        onUpdate(laneId, target.id, { direction })
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // No drag = tap → cycle velocity
      if (!dragged) {
        onCycleVelocity?.(laneId, target.id)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [getTriggerAt, getSvgX, laneId, onAdd, onUpdate, onCycleVelocity])

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    const target = getTriggerAt(e.clientX, e.clientY)
    if (target) onDelete(laneId, target.id)
  }, [getTriggerAt, laneId, onDelete])

  const handleTouchStart = useCallback((e) => {
    e.preventDefault()
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    const target = getTriggerAt(touch.clientX, touch.clientY, 12)

    if (!target) {
      const pos = Math.max(0, Math.min(1, getSvgX(touch.clientX)))
      const newId = onAdd(laneId, pos)

      const startY = touch.clientY
      const onMove = (te) => {
        if (te.touches.length !== 1) return
        const t = te.touches[0]
        const dy = startY - t.clientY
        const direction = Math.max(-1, Math.min(1, dy / STEM_MAX))
        onUpdate(laneId, newId, { direction })
      }
      const onEnd = () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
      }
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      return
    }

    const startX = touch.clientX
    const startY = touch.clientY
    const startPos = target.position
    const startDir = target.direction
    let mode = null
    let dragged = false
    let deleted = false
    const rect = svgRef.current?.getBoundingClientRect()

    const longPressTimer = setTimeout(() => {
      deleted = true
      onDelete(laneId, target.id)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }, 500)

    const onMove = (te) => {
      if (deleted || te.touches.length !== 1) return
      const t = te.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      if (!mode) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          clearTimeout(longPressTimer)
          dragged = true
          mode = Math.abs(dx) > Math.abs(dy) ? 'move' : 'direction'
        }
        return
      }

      if (mode === 'move') {
        const pos = Math.max(0, Math.min(1, startPos + dx / (rect?.width || 1)))
        onUpdate(laneId, target.id, { position: pos })
      } else {
        const direction = Math.max(-1, Math.min(1, startDir - dy / STEM_MAX))
        onUpdate(laneId, target.id, { direction })
      }
    }

    const onEnd = () => {
      clearTimeout(longPressTimer)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      if (!dragged && !deleted) {
        onCycleVelocity?.(laneId, target.id)
      }
    }

    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
  }, [getTriggerAt, getSvgX, laneId, onAdd, onUpdate, onDelete, onCycleVelocity])

  const cy = BAR_HEIGHT / 2
  const playX = `${playheadPosition * 100}%`

  return (
    <svg
      ref={svgRef}
      className="trigger-bar"
      width="100%"
      height={BAR_HEIGHT}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
    >
      <defs>
        {/* Void surface — deep gradient with a faint central glow */}
        <linearGradient id={`void-${laneId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12111c" />
          <stop offset="0.5" stopColor="#0d0c15" />
          <stop offset="1" stopColor="#0a0a11" />
        </linearGradient>
        <radialGradient id={`halo-${laneId}`} cx="50%" cy="50%" r="70%">
          <stop offset="0" stopColor="rgba(124,92,255,0.10)" />
          <stop offset="1" stopColor="rgba(124,92,255,0)" />
        </radialGradient>
      </defs>

      {/* Void background */}
      <rect width="100%" height={BAR_HEIGHT} fill={`url(#void-${laneId})`} />
      <rect width="100%" height={BAR_HEIGHT} fill={`url(#halo-${laneId})`} />

      {/* Center meridian */}
      <line x1="0" y1={cy} x2="100%" y2={cy} stroke="rgba(185,163,255,0.16)" strokeWidth="1" strokeDasharray="2,6" />

      {/* Grid lines at 25%, 50%, 75% */}
      {[0.25, 0.5, 0.75].map(p => (
        <line
          key={p}
          x1={`${p * 100}%`} y1="0"
          x2={`${p * 100}%`} y2={BAR_HEIGHT}
          stroke="rgba(185,163,255,0.10)" strokeWidth="0.5" strokeDasharray="2,5"
        />
      ))}

      {/* Triggers */}
      {triggers.map(t => {
        const color = triggerColor(t.direction)
        const stemLen = Math.abs(t.direction) * STEM_MAX
        const stemY1 = t.direction > 0 ? cy - stemLen : cy
        const stemY2 = t.direction > 0 ? cy : cy + stemLen
        const isFired = firedIds.has(t.id)
        const r = VELOCITY_RADIUS[t.velocity ?? 'high']
        const glowR = isFired ? r + 6 : 0

        return (
          <g key={t.id} data-id={t.id}>
            {isFired && (
              <circle
                cx={`${t.position * 100}%`} cy={cy}
                r={glowR}
                fill={color}
                opacity="0.3"
              />
            )}
            {stemLen > 0.5 && (
              <line
                x1={`${t.position * 100}%`} y1={stemY1}
                x2={`${t.position * 100}%`} y2={stemY2}
                stroke={color} strokeWidth={isFired ? 2 : 1.5}
                opacity={isFired ? 1 : 0.8}
              />
            )}
            <circle
              cx={`${t.position * 100}%`} cy={cy}
              r={r}
              fill={color}
              opacity={isFired ? 1 : 0.92}
              style={{ filter: `drop-shadow(0 0 ${isFired ? 6 : 3}px ${color})` }}
            />
            <circle
              cx={`${t.position * 100}%`} cy={cy}
              r={Math.max(1, r - 2.5)}
              fill="rgba(255,255,255,0.85)"
              opacity={isFired ? 0.9 : 0.55}
            />
          </g>
        )
      })}

      {/* Playhead */}
      <line
        x1={playX} y1="0"
        x2={playX} y2={BAR_HEIGHT}
        stroke="var(--accent)"
        strokeWidth="1.5"
        opacity="0.9"
        style={{ filter: 'drop-shadow(0 0 3px var(--accent))' }}
      />
    </svg>
  )
}
