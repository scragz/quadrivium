// ─────────────────────────────────────────────────────────────────────────────
// Session persistence
//
// The whole patch — tempo, master, and every box's knobs, switches, level,
// mute and trigger pattern — is mirrored into localStorage so a reload picks
// up where you left off.
//
// Two things deliberately do *not* survive a reload:
//
//   - **Samples.** A loaded sample lives as a decoded AudioBuffer behind a
//     blob: URL, and that URL is dead the moment the document is gone. There
//     is nothing to restore, so a restored box is back on its own voice.
//   - **Playing.** An AudioContext only starts from a user gesture, so a
//     restored session always comes up stopped, patch intact, waiting on play.
//
// Everything read back out is re-validated against `boxes/definitions.js`
// rather than trusted: a hand-edited or half-migrated blob otherwise reaches
// the audio graph as NaN, and a NaN in a Web Audio param throws where it
// lands rather than where it came from.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOXES,
  BOX_BY_ID,
  BPM_DEF,
  MASTER_DEF,
  LEVEL_DEF,
  defaultParams,
  defaultSwitches,
} from '../boxes/definitions.js'

const STORAGE_KEY = 'quadrivium.state.v1'

/** Bumped only for a shape change the validators below can't absorb. */
const SCHEMA_VERSION = 1

/**
 * How long the patch has to sit still before it is written.
 *
 * A knob or trigger drag changes state once per animation frame, and every one
 * of those pushes the write back — so a drag writes nothing at all until you
 * let go, rather than once per window while your hand is still moving.
 */
const SAVE_IDLE_MS = 1500

/**
 * Ceiling on the idle wait once the patch has settled. A page that never goes
 * idle — playing, with a rAF playhead — would otherwise defer the write
 * indefinitely, so past this the callback runs regardless.
 */
const IDLE_TIMEOUT_MS = 2000

/** Enough for a dense pattern, small enough that a junk blob can't stall us. */
const MAX_TRIGGERS_PER_BOX = 256

const VELOCITIES = ['high', 'med', 'low']

// ── Storage access ───────────────────────────────────────────────────────────

// Private windows, disabled site data and a full quota all surface as a throw
// from perfectly ordinary calls. Persistence is a convenience; losing it must
// never take the app down with it, so every access is guarded and the first
// failure turns the rest into no-ops.
let storage
let storageChecked = false

function getStorage() {
  if (storageChecked) return storage
  storageChecked = true
  try {
    const ls = window.localStorage
    const probe = `${STORAGE_KEY}.probe`
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    storage = ls
  } catch (_) {
    storage = null
  }
  return storage
}

// ── Validation ───────────────────────────────────────────────────────────────

function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function restoreParams(box, stored) {
  const params = defaultParams(box)
  if (!stored || typeof stored !== 'object') return params
  box.params.forEach((def) => {
    params[def.key] = clampNumber(stored[def.key], def.min, def.max, def.def)
  })
  return params
}

function restoreSwitches(box, stored) {
  const switches = defaultSwitches(box)
  if (!stored || typeof stored !== 'object') return switches
  box.switches.forEach((def) => {
    const value = stored[def.key]
    if (def.options.some((o) => o.value === value)) switches[def.key] = value
  })
  return switches
}

function restoreTriggers(stored, makeId) {
  if (!Array.isArray(stored)) return null
  // Ids are React keys and the handle TriggerBar flashes by, so a duplicate in
  // a hand-edited blob would fire two triggers as one.
  const seen = new Set()
  return stored.slice(0, MAX_TRIGGERS_PER_BOX).flatMap((t) => {
    if (!t || typeof t !== 'object') return []
    const position = clampNumber(t.position, 0, 1, null)
    if (position === null) return []
    const id = typeof t.id === 'string' && t.id && !seen.has(t.id) ? t.id : makeId()
    seen.add(id)
    return [{
      id,
      position,
      direction: clampNumber(t.direction, -1, 1, 0),
      velocity: VELOCITIES.includes(t.velocity) ? t.velocity : 'high',
    }]
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the stored patch back, validated against the current definitions.
 *
 * Returns `null` when there is nothing usable to restore — no storage, no
 * saved state, unreadable JSON or a version this build doesn't know — which
 * the caller reads as "come up on the defaults".
 *
 * `makeId` supplies an id for a stored trigger that lost its own.
 */
export function loadState(makeId) {
  const ls = getStorage()
  if (!ls) return null

  let raw
  try {
    raw = ls.getItem(STORAGE_KEY)
  } catch (_) {
    return null
  }
  if (!raw) return null

  let saved
  try {
    saved = JSON.parse(raw)
  } catch (_) {
    return null
  }
  if (!saved || typeof saved !== 'object' || saved.version !== SCHEMA_VERSION) return null

  const boxes = {}
  BOXES.forEach((box) => {
    const stored = saved.boxes?.[box.id]
    boxes[box.id] = {
      params: restoreParams(box, stored?.params),
      switches: restoreSwitches(box, stored?.switches),
      level: clampNumber(stored?.level, LEVEL_DEF.min, LEVEL_DEF.max, LEVEL_DEF.def),
      muted: stored?.muted === true,
      // null when there is no stored pattern at all, so the caller can tell
      // "never saved" (seed it) from "saved empty" (leave it empty).
      triggers: restoreTriggers(stored?.triggers, makeId),
    }
  })

  return {
    bpm: clampNumber(saved.bpm, BPM_DEF.min, BPM_DEF.max, BPM_DEF.def),
    masterVolume: clampNumber(saved.masterVolume, MASTER_DEF.min, MASTER_DEF.max, MASTER_DEF.def),
    boxes,
  }
}

function serialize({ bpm, masterVolume, boxes }) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    bpm,
    masterVolume,
    // Keyed by id rather than positional, so reordering or renumbering the
    // rack doesn't hand one box another's settings.
    boxes: Object.fromEntries(
      boxes
        .filter((b) => BOX_BY_ID[b.id])
        .map((b) => [
          b.id,
          {
            params: b.params,
            switches: b.switches,
            level: b.level,
            muted: b.muted,
            triggers: b.triggers.map((t) => ({
              id: t.id,
              position: t.position,
              direction: t.direction,
              velocity: t.velocity ?? 'high',
            })),
          },
        ])
    ),
  })
}

let pending = null
let timer = null
let idleId = null

const requestIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : null
const cancelIdle = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : null

function write(snapshot) {
  const ls = getStorage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_KEY, serialize(snapshot))
  } catch (_) {
    // Quota, or storage revoked mid-session. Nothing useful to do here — the
    // next save gets another go.
  }
}

function commit() {
  const snap = pending
  pending = null
  if (snap) write(snap)
}

/**
 * Queue a save.
 *
 * This runs on every state change — once per animation frame under a drag —
 * so the write is kept off the frame twice over: the timer restarts on each
 * change, so an unbroken drag writes nothing until it ends, and the write
 * itself then waits for an idle callback rather than landing in whatever the
 * page is doing. Anything on the main thread competes with the transport's
 * lookahead window; see AGENTS.md ("Keeping the audio thread fed").
 */
export function persistState(snapshot) {
  if (!getStorage()) return
  pending = snapshot
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (!requestIdle) {
      commit()
      return
    }
    idleId = requestIdle(() => {
      idleId = null
      commit()
    }, { timeout: IDLE_TIMEOUT_MS })
  }, SAVE_IDLE_MS)
}

/**
 * Write any queued save immediately — for a tab that may not come back.
 *
 * With a trailing debounce this is what guarantees a save at all: leaving the
 * page mid-drag banks the patch that was never idle long enough to write.
 */
export function flushPersistedState() {
  cancelScheduled()
  commit()
}

function cancelScheduled() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (idleId !== null) {
    // Without cancelIdleCallback the callback still fires; commit() finds
    // nothing pending and does nothing.
    cancelIdle?.(idleId)
    idleId = null
  }
}

/** Drop the saved patch. The next load comes up on the seed pattern. */
export function clearPersistedState() {
  cancelScheduled()
  pending = null
  const ls = getStorage()
  if (!ls) return
  try {
    ls.removeItem(STORAGE_KEY)
  } catch (_) {}
}
