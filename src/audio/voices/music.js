import * as Tone from 'tone'
import { clamp, stackTrim } from '../levels.js'

// ── III · MUSIC — THE MONOCHORD ──────────────────────────────────────────────
//
// One string, stopped at a ratio. TEMPER is the interesting switch: JUST uses
// the small whole-number ratios the quadrivium was actually about, EQUAL uses
// the twelfth root of two. On a fifth that's a ~2 cent difference — audible as
// beating against the drone rather than as a change of pitch.

const JUST = { unison: 1, third: 5 / 4, fourth: 4 / 3, fifth: 3 / 2 }
const EQUAL = {
  unison: 1,
  third: Math.pow(2, 4 / 12),
  fourth: Math.pow(2, 5 / 12),
  fifth: Math.pow(2, 7 / 12),
}

const WAVEFORM = 'sawtooth'
const DEFAULT_DECAY = 3.5
const VOICE_COUNT = 4

// Measured compensation for this box's default effect chain — see AGENTS.md.
const FX_MAKEUP = 1.46

export function createMusicVoice() {
  // Root pair (detuned against each other), the stopped interval, and the octave.
  const oscs = [
    new Tone.Oscillator({ frequency: 196, type: WAVEFORM }),
    new Tone.Oscillator({ frequency: 196, type: WAVEFORM }),
    new Tone.Oscillator({ frequency: 294, type: WAVEFORM }),
    new Tone.Oscillator({ frequency: 392, type: WAVEFORM }),
  ]
  const trim = new Tone.Gain(stackTrim(WAVEFORM, VOICE_COUNT))
  oscs.forEach((o) => o.connect(trim))

  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.6, wet: 0.4 })
  const reverb = new Tone.Reverb({ decay: DEFAULT_DECAY, wet: 0.35 })
  const tone = new Tone.Filter({ type: 'lowpass', frequency: 5200, rolloff: -12, Q: 0.7 })
  const out = new Tone.Gain(FX_MAKEUP)
  chorus.connect(reverb)
  reverb.connect(tone)
  tone.connect(out)

  let running = false
  let decayTimer = null
  let appliedDecay = DEFAULT_DECAY
  let pendingDecay = DEFAULT_DECAY

  function flushDecay() {
    clearTimeout(decayTimer)
    decayTimer = null
    if (pendingDecay === appliedDecay) return
    appliedDecay = pendingDecay
    reverb.decay = pendingDecay
  }

  return {
    sourceOut: trim,
    fxIn: chorus,
    fxOut: out,

    start() {
      if (running) return
      oscs.forEach((o) => o.start())
      chorus.start()
      running = true
    },

    stop() {
      if (!running) return
      oscs.forEach((o) => o.stop())
      running = false
    },

    set(p, sw) {
      const table = sw.temper === 'equal' ? EQUAL : JUST
      const ratio = table[sw.interval] ?? 1
      const root = clamp(p.pitch, 8, 6000)
      const spread = clamp(p.spread, 0, 40)

      const targets = [
        { hz: root, cents: -spread },
        { hz: root, cents: +spread },
        { hz: root * ratio, cents: spread * 0.35 },
        { hz: root * 2, cents: -spread * 0.6 },
      ]
      targets.forEach((t, i) => {
        oscs[i].frequency.rampTo(clamp(t.hz, 8, 18000), 0.04)
        oscs[i].detune.rampTo(t.cents, 0.04)
      })

      const bloom = clamp(p.bloom, 0, 1)
      chorus.depth = 0.15 + bloom * 0.85
      chorus.frequency.rampTo(0.2 + bloom * 2.2, 0.1)
      chorus.wet.rampTo(bloom, 0.05)

      reverb.wet.rampTo(clamp(p.hall, 0, 1), 0.05)

      // Reverb rebuilds its impulse response on every decay change, so only
      // act on a settled value.
      pendingDecay = p.decay
      if (Math.abs(p.decay - appliedDecay) > 0.05) {
        clearTimeout(decayTimer)
        decayTimer = setTimeout(flushDecay, 220)
      }

      tone.frequency.rampTo(p.tone, 0.05)
    },

    // Nobody waits 220 ms for a debounce inside an offline render, and an
    // ungenerated impulse response renders as silence on the wet path — so
    // settle the decay, then wait for the IR it asks for.
    async ready() {
      flushDecay()
      await reverb.ready
    },

    dispose() {
      clearTimeout(decayTimer)
      ;[...oscs, trim, chorus, reverb, tone, out].forEach((n) => n.dispose())
    },
  }
}
