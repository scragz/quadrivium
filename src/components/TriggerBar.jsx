import { useRef, useCallback, useEffect, useMemo } from 'react'
import { subscribePlayhead } from '../audio/playhead.js'

const BAR_HEIGHT = 80
const CY = BAR_HEIGHT / 2
const DRAG_THRESHOLD = 4
const STEM_MAX = 30

// Velocity → circle radius
const VELOCITY_RADIUS = { high: 8, med: 5.5, low: 3.5 }
// Velocity → touch hit bonus (smaller targets need bigger hit area)
const VELOCITY_HIT = { high: 4, med: 6, low: 8 }

function lerp(a, b, t) { return a + (b - a) * t }

function parseHex(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Swell (-1) sits on the box's accent, ping (+1) on its brighter tint. */
function makeTriggerColor(accent, accent2) {
  const from = parseHex(accent)
  const to = parseHex(accent2)
  return (direction) => {
    const t = (direction + 1) / 2
    const c = from.map((v, i) => Math.round(lerp(v, to[i], t)))
    return `rgb(${c[0]},${c[1]},${c[2]})`
  }
}

export function TriggerBar({
  laneId,
  triggers,
  accent = '#9a86e6',
  accent2 = '#d9f2ff',
  onAdd,
  onUpdate,
  onLiveUpdate,
  onDelete,
  onCycleVelocity,
}) {
  const svgRef = useRef(null)
  const playheadRef = useRef(null)
  const triggerColor = useMemo(() => makeTriggerColor(accent, accent2), [accent, accent2])

  // The playhead and the fire flash are written straight to the DOM. Feeding
  // them through React state re-rendered the whole rack every animation frame,
  // and since Tone's transport callbacks share the main thread, that backlog is
  // what made triggers land late and the audio chop.
  const triggersRef = useRef(triggers)
  triggersRef.current = triggers
  const prevPlayhead = useRef(0)
  const flashTimers = useRef(new Map())

  useEffect(() => {
    const timers = flashTimers.current

    const flash = (id) => {
      const el = svgRef.current?.querySelector(`[data-id="${id}"]`)
      if (!el) return
      el.dataset.fired = '1'
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        delete el.dataset.fired
      }, 200))
    }

    const clearFlashes = () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      svgRef.current?.querySelectorAll('[data-fired]').forEach((el) => {
        delete el.dataset.fired
      })
    }

    const unsubscribe = subscribePlayhead((pos, reset) => {
      const line = playheadRef.current
      if (line) {
        const x = `${pos * 100}%`
        line.setAttribute('x1', x)
        line.setAttribute('x2', x)
      }

      const prev = prevPlayhead.current
      prevPlayhead.current = pos
      if (reset) {
        clearFlashes()
        return
      }

      // Forward motion is prev→pos; a wrap past the loop point splits the span.
      for (const t of triggersRef.current) {
        const crossed = prev <= pos
          ? t.position >= prev && t.position < pos
          : t.position >= prev || t.position < pos
        if (crossed) flash(t.id)
      }
    })

    return () => {
      unsubscribe()
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  /**
   * A handle that moves one trigger mark by writing its geometry, exactly as
   * React would, straight to the DOM.
   *
   * Dragging used to go through React state on every mousemove, which
   * re-rendered the pedal and — far worse — rebuilt every scheduled transport
   * event in the rack, sixty times a second. Same reasoning as the playhead
   * above: what moves per frame doesn't go through React. The attributes
   * written here are the ones React writes, so the commit on mouse-up lands on
   * the values already on screen and nothing has to be undone.
   */
  const grabMark = useCallback((triggerId) => {
    const g = svgRef.current?.querySelector(`[data-id="${triggerId}"]`)
    if (!g) return null
    const glow = g.querySelector('.trigger-glow')
    const dot = g.querySelector('.trigger-dot')
    const core = g.querySelector('.trigger-core')
    const stem = g.querySelector('.trigger-stem')
    if (!glow || !dot || !core || !stem) return null

    return {
      position(pos) {
        const x = `${pos * 100}%`
        glow.setAttribute('cx', x)
        dot.setAttribute('cx', x)
        core.setAttribute('cx', x)
        stem.setAttribute('x1', x)
        stem.setAttribute('x2', x)
      },
      direction(dir) {
        const len = Math.abs(dir) * STEM_MAX
        stem.setAttribute('y1', dir > 0 ? CY - len : CY)
        stem.setAttribute('y2', dir > 0 ? CY : CY + len)
        g.style.color = triggerColor(dir)
      },
    }
  }, [triggerColor])

  /**
   * One drag, from press to release: the mark's geometry goes to the DOM and
   * the change goes to the engine on every move; React hears about it once, at
   * the end. `onLiveUpdate` moves just this trigger's transport event, so the
   * sound follows the mark without the schedule being rebuilt each frame.
   */
  const startDrag = useCallback((triggerId) => {
    let mark = null
    const edits = {}

    return {
      apply(updates) {
        // A mark that was only just added appears a render later, so keep
        // trying until it's there.
        if (!mark) mark = grabMark(triggerId)
        Object.assign(edits, updates)
        if (mark) {
          if (updates.position !== undefined) mark.position(updates.position)
          if (updates.direction !== undefined) mark.direction(updates.direction)
        }
        onLiveUpdate?.(laneId, triggerId, updates)
      },
      commit() {
        if (Object.keys(edits).length > 0) onUpdate(laneId, triggerId, edits)
      },
    }
  }, [grabMark, laneId, onLiveUpdate, onUpdate])

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

      const drag = startDrag(newId)
      const startY = e.clientY
      const onMove = (me) => {
        const dy = startY - me.clientY
        drag.apply({ direction: Math.max(-1, Math.min(1, dy / STEM_MAX)) })
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        drag.commit()
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
    const drag = startDrag(target.id)

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
        drag.apply({ position: Math.max(0, Math.min(1, startPos + dx / (rect?.width || 1))) })
      } else {
        drag.apply({ direction: Math.max(-1, Math.min(1, startDir - dy / STEM_MAX)) })
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // No drag = tap → cycle velocity
      if (dragged) drag.commit()
      else onCycleVelocity?.(laneId, target.id)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [getTriggerAt, getSvgX, laneId, onAdd, startDrag, onCycleVelocity])

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

      const drag = startDrag(newId)
      const startY = touch.clientY
      const onMove = (te) => {
        if (te.touches.length !== 1) return
        const t = te.touches[0]
        const dy = startY - t.clientY
        drag.apply({ direction: Math.max(-1, Math.min(1, dy / STEM_MAX)) })
      }
      const onEnd = () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
        drag.commit()
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
    const drag = startDrag(target.id)

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
        drag.apply({ position: Math.max(0, Math.min(1, startPos + dx / (rect?.width || 1))) })
      } else {
        drag.apply({ direction: Math.max(-1, Math.min(1, startDir - dy / STEM_MAX)) })
      }
    }

    const onEnd = () => {
      clearTimeout(longPressTimer)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      if (deleted) return
      if (dragged) drag.commit()
      else onCycleVelocity?.(laneId, target.id)
    }

    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
  }, [getTriggerAt, getSvgX, laneId, onAdd, startDrag, onDelete, onCycleVelocity])

  const cy = BAR_HEIGHT / 2

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
          <stop offset="0" stopColor="#0f0e16" />
          <stop offset="0.5" stopColor="#0b0a12" />
          <stop offset="1" stopColor="#08070e" />
        </linearGradient>
        <radialGradient id={`halo-${laneId}`} cx="50%" cy="50%" r="70%">
          <stop offset="0" stopColor={accent} stopOpacity="0.10" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Void background */}
      <rect width="100%" height={BAR_HEIGHT} fill={`url(#void-${laneId})`} />
      <rect width="100%" height={BAR_HEIGHT} fill={`url(#halo-${laneId})`} />

      {/* Center meridian */}
      <line
        x1="0" y1={cy} x2="100%" y2={cy}
        stroke={accent} strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2,6"
      />

      {/* Sixteenth-note grid, with the quarters picked out */}
      {Array.from({ length: 15 }, (_, i) => (i + 1) / 16).map(p => {
        const quarter = Math.abs((p * 4) % 1) < 1e-6
        return (
          <line
            key={p}
            x1={`${p * 100}%`} y1="0"
            x2={`${p * 100}%`} y2={BAR_HEIGHT}
            stroke={accent}
            strokeOpacity={quarter ? 0.16 : 0.07}
            strokeWidth={quarter ? 0.8 : 0.5}
            strokeDasharray={quarter ? '3,5' : '2,6'}
          />
        )
      })}

      {/* Triggers. The fire flash is a `data-fired` attribute set imperatively
          from the playhead subscription, so styling it lives in CSS and React
          never has to re-render the bar in time with the transport. */}
      {triggers.map(t => {
        const x = `${t.position * 100}%`
        const stemLen = Math.abs(t.direction) * STEM_MAX
        const stemY1 = t.direction > 0 ? cy - stemLen : cy
        const stemY2 = t.direction > 0 ? cy : cy + stemLen
        // The stem is always rendered, even at zero length (butt-capped, so it
        // paints nothing): a drag writes to it, and an element that comes and
        // goes is one the drag would have to keep re-finding.
        const r = VELOCITY_RADIUS[t.velocity ?? 'high']

        return (
          <g
            key={t.id}
            data-id={t.id}
            className="trigger"
            style={{ color: triggerColor(t.direction) }}
          >
            <circle className="trigger-glow" cx={x} cy={cy} r={r + 6} />
            <line className="trigger-stem" x1={x} y1={stemY1} x2={x} y2={stemY2} />
            <circle className="trigger-dot" cx={x} cy={cy} r={r} />
            <circle className="trigger-core" cx={x} cy={cy} r={Math.max(1, r - 2.5)} />
          </g>
        )
      })}

      {/* Playhead — x is written by the subscription above, never by React. */}
      <line
        ref={playheadRef}
        className="trigger-playhead"
        y1="0" y2={BAR_HEIGHT}
        style={{ color: accent2, filter: `drop-shadow(0 0 3px ${accent})` }}
      />
    </svg>
  )
}
