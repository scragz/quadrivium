import * as Tone from 'tone'
import { TARGET_RMS, clamp } from '../levels.js'

// ── II · GEOMETRY — THE GNOMON ───────────────────────────────────────────────
//
// A wavefolder is the most literally geometric thing in synthesis: the signal
// is a line, and folding reflects it back inside a boundary. SKEW offsets the
// line before it folds, so the two halves of the figure stop being congruent.
// Downstream, a pitch-tuned comb sets up a standing wave — resonance as ratio.

const WAVE_BY_SIDES = { 3: 'triangle', 4: 'square', 6: 'sawtooth' }
const COMB_RATIO = { unison: 1, octave: 2, fifth: 1.5 }

const CURVE_LEN = 2048

// Measured compensation for this box's default effect chain — see AGENTS.md.
const FX_MAKEUP = 1.04

/** Triangle fold: identity inside ±1, reflected outside it. */
function foldTri(v) {
  return (2 / Math.PI) * Math.asin(Math.sin((v * Math.PI) / 2))
}

/**
 * AC RMS of one cycle of `waveform` pushed through the current fold, so the
 * output can be trimmed back to TARGET_RMS. Folding raises RMS as it adds
 * crossings, and SKEW adds DC — both are measured here rather than guessed.
 */
function foldedRms(waveform, drive, skew) {
  const N = 512
  let sum = 0
  let mean = 0
  const ys = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const ph = i / N
    let x
    if (waveform === 'triangle') x = 4 * Math.abs(ph - 0.5) - 1
    else if (waveform === 'square') x = ph < 0.5 ? 1 : -1
    else x = 2 * ph - 1
    const y = foldTri(x * drive + skew)
    ys[i] = y
    mean += y
  }
  mean /= N
  for (let i = 0; i < N; i++) sum += (ys[i] - mean) ** 2
  return Math.sqrt(sum / N)
}

export function createGeometryVoice() {
  const osc = new Tone.Oscillator({ frequency: 146, type: 'triangle' })
  const folder = new Tone.WaveShaper((x) => x, CURVE_LEN)
  // Folding an offset wave leaves DC behind; strip it before the gate.
  const dcBlock = new Tone.Filter({ type: 'highpass', frequency: 12, rolloff: -12 })
  const trim = new Tone.Gain(0.2)

  osc.connect(folder)
  folder.connect(dcBlock)
  dcBlock.connect(trim)

  const comb = new Tone.FeedbackCombFilter({ delayTime: 1 / 146, resonance: 0.2 })
  const tone = new Tone.Filter({ type: 'lowpass', frequency: 7000, rolloff: -12, Q: 1 })
  const out = new Tone.Gain(FX_MAKEUP)
  comb.connect(tone)
  tone.connect(out)

  let running = false
  let curveKey = ''
  let sides = 3

  return {
    sourceOut: trim,
    fxIn: comb,
    fxOut: out,

    start() {
      if (running) return
      osc.start()
      running = true
    },

    stop() {
      if (!running) return
      osc.stop()
      running = false
    },

    set(p, sw) {
      if (sw.sides !== sides) {
        sides = sw.sides
        osc.type = WAVE_BY_SIDES[sides] ?? 'triangle'
        curveKey = '' // waveform changed, so the trim needs recomputing
      }

      osc.frequency.rampTo(clamp(p.pitch, 8, 18000), 0.03)

      const drive = 1 + clamp(p.fold, 0, 1) * 7
      const skew = clamp(p.skew, -1, 1) * 1.5
      const key = `${sides}:${drive.toFixed(3)}:${skew.toFixed(3)}`
      if (key !== curveKey) {
        curveKey = key
        folder.setMap((x) => foldTri(x * drive + skew), CURVE_LEN)
        const rms = foldedRms(WAVE_BY_SIDES[sides] ?? 'triangle', drive, skew)
        trim.gain.rampTo(rms > 1e-4 ? clamp(TARGET_RMS / rms, 0, 8) : 0, 0.04)
      }

      const combHz = clamp(p.pitch * (COMB_RATIO[sw.axis] ?? 1), 20, 8000)
      comb.delayTime.rampTo(1 / combHz, 0.05)
      comb.resonance.rampTo(clamp(p.comb, 0, 0.92), 0.05)

      tone.frequency.rampTo(p.tone, 0.05)
      // RESO is the cutoff's Q — the classic pairing with TONE.
      tone.Q.rampTo(0.7 + clamp(p.reso, 0, 1) * 11, 0.05)
    },

    dispose() {
      ;[osc, folder, dcBlock, trim, comb, tone, out].forEach((n) => n.dispose())
    },
  }
}
