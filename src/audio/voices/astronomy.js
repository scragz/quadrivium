import * as Tone from 'tone'
import { clamp, noiseBandRms, trimFor } from '../levels.js'

// ── IV · ASTRONOMY — THE ORRERY ──────────────────────────────────────────────
//
// A band of noise carried slowly around a circle. RADIUS is where the band
// sits, APERTURE how tight it is, ORBIT and DRIFT the rate and eccentricity of
// its travel. This is the box where the level fix matters most: at APERTURE 24
// the bandpass throws away ~30 dB, and the makeup gain has to track it live.

const LFO_TYPE = { circle: 'sine', ellipse: 'triangle', comet: 'sawtooth' }

// Measured compensation for this box's default effect chain — see AGENTS.md.
const FX_MAKEUP = 1.33

export function createAstronomyVoice() {
  const noise = new Tone.Noise({ type: 'pink' })
  const band = new Tone.Filter({ type: 'bandpass', frequency: 420, Q: 6 })
  const trim = new Tone.Gain(1)

  // Connecting a signal to a Param in Tone *overrides* it — the param is zeroed
  // and the signal becomes its only source. So the LFO owns the band frequency
  // outright and RADIUS/DRIFT are expressed as its endpoints, never by writing
  // to band.frequency (which would be silently ignored, leaving a 0 Hz filter).
  const lfo = new Tone.LFO({ frequency: 0.12, min: 420, max: 420, type: 'sine' })

  noise.connect(band)
  band.connect(trim)
  lfo.connect(band.frequency)

  const phaser = new Tone.Phaser({ frequency: 0.25, octaves: 3, baseFrequency: 300, wet: 0.3 })
  const reverb = new Tone.Reverb({ decay: 8, wet: 0.45 })
  const out = new Tone.Gain(FX_MAKEUP)
  phaser.connect(reverb)
  reverb.connect(out)

  let running = false
  let color = 'pink'
  let path = 'circle'

  return {
    sourceOut: trim,
    fxIn: phaser,
    fxOut: out,

    start() {
      if (running) return
      noise.start()
      lfo.start()
      running = true
    },

    stop() {
      if (!running) return
      noise.stop()
      lfo.stop()
      running = false
    },

    set(p, sw) {
      if (sw.spectrum !== color) {
        color = sw.spectrum
        noise.type = color
      }
      if (sw.path !== path) {
        path = sw.path
        lfo.type = LFO_TYPE[path] ?? 'sine'
      }

      const radius = clamp(p.radius, 20, 16000)
      const q = clamp(p.aperture, 0.5, 24)
      band.Q.rampTo(q, 0.06)

      // The sweep is proportional to radius, so it stays musical whether the
      // band sits at 40 Hz or 9 kHz.
      const spread = clamp(p.drift, 0, 1) * 0.9
      lfo.min = clamp(radius * (1 - spread), 20, 18000)
      lfo.max = clamp(radius * (1 + spread), 20, 18000)
      lfo.frequency.rampTo(clamp(p.orbit, 0.01, 8), 0.1)

      // The whole point: a narrow band discards most of the noise's energy, so
      // the makeup gain is recomputed from the live radius and aperture.
      const sr = Tone.getContext().sampleRate
      trim.gain.rampTo(trimFor(noiseBandRms(color, radius, q, sr)), 0.06)

      const ph = clamp(p.phase, 0, 1)
      phaser.wet.rampTo(ph, 0.06)
      phaser.frequency.rampTo(0.05 + ph * 1.2, 0.1)

      reverb.wet.rampTo(clamp(p.void, 0, 1), 0.06)
    },

    dispose() {
      ;[noise, band, trim, lfo, phaser, reverb, out].forEach((n) => n.dispose())
    },
  }
}
