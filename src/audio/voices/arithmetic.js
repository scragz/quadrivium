import * as Tone from 'tone'
import { clamp, pulseRms, trimFor, widthToDuty } from '../levels.js'

// ── I · ARITHMETIC — THE MONAD ───────────────────────────────────────────────
//
// A pulse against a whole-number division of itself, then quantized. Every
// control is a count: the partial is an integer multiple, the sub is an
// integer division, and CRUSH literally removes bits of resolution.

const PRIMES = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]

// Measured compensation for this box's default effect chain — see AGENTS.md.
const FX_MAKEUP = 0.99

export function createArithmeticVoice() {
  const main = new Tone.PulseOscillator({ frequency: 110, width: 0 })
  const sub = new Tone.PulseOscillator({ frequency: 55, width: 0 })

  const mainTrim = new Tone.Gain(0.16)
  const subTrim = new Tone.Gain(0)
  const mix = new Tone.Gain(1)

  // Any duty cycle other than 50% carries DC. The gate multiplies that DC by
  // the envelope, which arrives at the speaker as a thump — block it here.
  const dcBlock = new Tone.Filter({ type: 'highpass', frequency: 12, rolloff: -12 })

  main.connect(mainTrim)
  sub.connect(subTrim)
  mainTrim.connect(mix)
  subTrim.connect(mix)
  mix.connect(dcBlock)

  const crush = new Tone.BitCrusher({ bits: 12, wet: 0 })
  const tone = new Tone.Filter({ type: 'lowpass', frequency: 9000, rolloff: -12, Q: 0.7 })
  const out = new Tone.Gain(FX_MAKEUP)
  crush.connect(tone)
  tone.connect(out)

  let running = false

  return {
    sourceOut: dcBlock,
    fxIn: crush,
    fxOut: out,

    start() {
      if (running) return
      main.start()
      sub.start()
      running = true
    },

    stop() {
      if (!running) return
      main.stop()
      sub.stop()
      running = false
    },

    set(p, sw) {
      const step = Math.round(p.ratio)
      const ratio = sw.series === 'prime' ? PRIMES[step - 1] ?? 1 : step

      // Tone's width is bipolar: 0 is a square, ±1 collapses to DC.
      const width = clamp(p.width, -0.92, 0.92)
      main.frequency.rampTo(clamp(p.pitch * ratio, 8, 18000), 0.03)
      main.width.rampTo(width, 0.03)
      sub.frequency.rampTo(clamp(p.pitch / sw.divisor, 8, 18000), 0.03)

      // Main and sub are at unrelated frequencies, so they sum in power.
      // Normalizing by sqrt(1 + s²) keeps the pair at TARGET_RMS as SUB opens.
      const s = clamp(p.sub, 0, 1)
      const norm = Math.sqrt(1 + s * s)
      mainTrim.gain.rampTo(trimFor(pulseRms(widthToDuty(width))) / norm, 0.03)
      subTrim.gain.rampTo((trimFor(pulseRms(0.5)) * s) / norm, 0.03)

      const c = clamp(p.crush, 0, 1)
      crush.bits.value = Math.round(12 - c * 10)
      crush.wet.rampTo(c, 0.05)

      tone.frequency.rampTo(p.tone, 0.05)
    },

    dispose() {
      ;[main, sub, mainTrim, subTrim, mix, dcBlock, crush, tone, out].forEach((n) => n.dispose())
    },
  }
}
