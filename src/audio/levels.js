// ─────────────────────────────────────────────────────────────────────────────
// Gain staging
//
// Every source is normalized to a common RMS *before* it hits the low-pass
// gate, so swapping a square oscillator for band-passed noise doesn't change
// how loud the box is. Without this the two are wildly mismatched: a unit
// square oscillator measures ~0.997 RMS, while white noise through a Q=8
// bandpass at 220 Hz measures ~0.0255 RMS — a 32 dB gap.
//
// Constants below were measured against Tone.js 15's own generators; see
// AGENTS.md ("Level calibration") for the method and the raw numbers.
// ─────────────────────────────────────────────────────────────────────────────

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

/** Target RMS every voice is trimmed to before the gate (≈ -16 dBFS). */
export const TARGET_RMS = 0.16

/** Ceiling on normalization gain (+36 dB) so extreme Q can't run away. */
const MAX_TRIM = 64

/** Measured RMS of Tone's noise buffers at unit amplitude (uniform white). */
const WHITE_RMS = 0.578

/** Measured RMS of Tone.Oscillator waveforms at unit amplitude. */
export const OSC_RMS = {
  sine: 0.707,
  triangle: 0.577,
  sawtooth: 0.575,
  square: 0.997,
}

/**
 * AC RMS of a ±1 pulse at the given duty cycle. Tone's PulseOscillator
 * thresholds a sawtooth to ±1, so only the duty matters.
 *
 * Careful: Tone's `width` is bipolar (-1..1, with 0 meaning a square), *not* a
 * duty cycle — use `widthToDuty` before calling this.
 *
 * The DC component is `2·duty - 1`, so voices using pulses must DC-block
 * before the gate or the envelope turns that offset into a thump.
 */
export function pulseRms(duty) {
  const d = clamp(duty, 0.01, 0.99)
  return 2 * Math.sqrt(d * (1 - d))
}

/** Tone's bipolar pulse `width` → duty cycle in 0..1. */
export function widthToDuty(width) {
  return (clamp(width, -1, 1) + 1) / 2
}

/**
 * RMS of a noise source after a 2-pole bandpass at `f0` with quality `Q`.
 *
 * White is the analytic result: sigma · sqrt(ENBW / nyquist), where the noise
 * equivalent bandwidth of an RBJ bandpass is ENBW = pi·f0 / 2Q. Measured
 * within 1% for Q <= 8 and 4% at Q = 24.
 *
 * Pink is ~flat across f0 (its 1/f density cancels the bandwidth growth), and
 * brown falls off as 1/sqrt(f0) above the ~140 Hz corner of Tone's leaky
 * integrator. Both anchored to measurements at Q = 8.
 */
export function noiseBandRms(color, f0, Q, sampleRate = 44100) {
  const q = Math.max(0.3, Q)
  const freq = Math.max(20, f0)

  if (color === 'pink') return 0.0272 * Math.sqrt(8 / q)
  if (color === 'brown') {
    return 0.047 * Math.sqrt(8 / q) * Math.sqrt(220 / Math.max(140, freq))
  }

  const nyquist = sampleRate / 2
  const enbw = (Math.PI * freq) / (2 * q)
  return WHITE_RMS * Math.sqrt(Math.min(1, enbw / nyquist))
}

/** Gain that brings a signal of the given RMS up (or down) to TARGET_RMS. */
export function trimFor(rms) {
  if (!(rms > 0)) return 1
  return clamp(TARGET_RMS / rms, 0, MAX_TRIM)
}

/** Convenience: trim for a named oscillator waveform. */
export function oscTrim(waveform) {
  return trimFor(OSC_RMS[waveform] ?? OSC_RMS.sawtooth)
}

/**
 * Trim for a stack of `n` detuned voices. Uncorrelated partials sum in power,
 * so the stack is sqrt(n) louder than one voice.
 */
export function stackTrim(waveform, n) {
  return oscTrim(waveform) / Math.sqrt(Math.max(1, n))
}

// ── Volume taper ─────────────────────────────────────────────────────────────
//
// A linear 0..1 gain fader feels broken: 0.5 is only -6 dB, so the top 90% of
// the travel barely changes anything and everything happens in the last sliver.
// Raising position to a power gives a conventional audio taper that still
// reaches true silence at 0.

const VOLUME_TAPER = 2.5

export function volumeToGain(position) {
  const p = clamp(position, 0, 1)
  return p <= 0 ? 0 : Math.pow(p, VOLUME_TAPER)
}

export function gainToDb(gain) {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}

/** Label for a volume knob, in dB — honest about what the taper is doing. */
export function formatVolume(position) {
  const db = gainToDb(volumeToGain(position))
  if (!Number.isFinite(db)) return '−∞'
  return `${db >= -0.05 ? '0.0' : db.toFixed(1)}`
}
