import { createArithmeticVoice } from './arithmetic.js'
import { createGeometryVoice } from './geometry.js'
import { createMusicVoice } from './music.js'
import { createAstronomyVoice } from './astronomy.js'

// Every voice exposes the same shape so the engine can host it generically:
//
//   sourceOut  → node the gate listens to (pre-gate: oscillators, folding)
//   fxIn/fxOut → post-gate chain (crush, comb, reverb — tails outlive the gate)
//   start/stop → source lifecycle
//   set(params, switches) → apply a full control snapshot
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
