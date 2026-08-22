import { createArithmeticVoice } from './arithmetic.js'
import { createGeometryVoice } from './geometry.js'
import { createMusicVoice } from './music.js'
import { createAstronomyVoice, REVERB_DECAY as ASTRONOMY_DECAY } from './astronomy.js'

// Every voice exposes the same shape so the engine can host it generically:
//
//   sourceOut  → node the gate listens to (pre-gate: oscillators, folding)
//   fxIn/fxOut → post-gate chain (crush, comb, reverb — tails outlive the gate)
//   start/stop → source lifecycle
//   set(params, switches) → apply a full control snapshot
//   ready() → optional; resolves once anything built asynchronously (a reverb
//             impulse response) is in place. Only an offline render waits.
//   dispose()
const FACTORIES = {
  arithmetic: createArithmeticVoice,
  geometry: createGeometryVoice,
  music: createMusicVoice,
  astronomy: createAstronomyVoice,
}

export function createVoice(boxId) {
  const factory = FACTORIES[boxId]
  if (!factory) throw new Error(`Unknown box: ${boxId}`)
  return factory()
}

/**
 * How long this box keeps sounding after its gate has shut, in seconds.
 *
 * Used by the offline renderer to size the tail it wraps back around the loop.
 * Arithmetic has no time-based effect at all, and Geometry's comb rings for at
 * most ~0.6 s even at maximum resonance — both sit inside the envelope floor
 * the renderer applies anyway, so only the two reverbs are worth reporting.
 */
export function voiceTail(boxId, params) {
  if (boxId === 'music') return params.hall > 0 ? params.decay : 0
  if (boxId === 'astronomy') return params.void > 0 ? ASTRONOMY_DECAY : 0
  return 0
}
