// ─────────────────────────────────────────────────────────────────────────────
// The four boxes.
//
// One per liberal art of the quadrivium, in the Boethian order — number in
// itself, number in space, number in time, number in space and time. Each is a
// self-contained pedal: its own faceplate, its own synthesis, its own effect.
//
// This file is the single source of truth for a box's identity, controls and
// defaults. The engine reads `params` / `switches` generically; the UI reads
// `theme` and the label copy. Adding a knob means adding it here and reading
// it in that box's voice module.
// ─────────────────────────────────────────────────────────────────────────────

/** Knob taper: 'lin' for ranges that cross zero, 'exp' for frequency & time. */
const LIN = 'lin'
const EXP = 'exp'

const pct = (v) => `${Math.round(v * 100)}`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : `${Math.round(v)}`)
const int = (v) => `${Math.round(v)}`

export const BOXES = [
  // ── I ──────────────────────────────────────────────────────────────────────
  {
    id: 'arithmetic',
    numeral: 'I',
    name: 'ARITHMETIC',
    device: 'THE MONAD',
    tagline: 'NUMBER IN ITSELF',
    blurb: 'Pulse divided against itself, quantized to whole steps.',
    theme: {
      accent: '#e8b64c',
      accent2: '#ffd98a',
      glow: 'rgba(232, 182, 76, 0.45)',
      plate: '#191408',
      plateHi: '#241c0d',
      edge: 'rgba(232, 182, 76, 0.22)',
      edgeStrong: 'rgba(232, 182, 76, 0.45)',
    },
    params: [
      { key: 'pitch', label: 'PITCH', min: 24, max: 1200, def: 110, curve: EXP, unit: 'hz', format: hz },
      { key: 'ratio', label: 'RATIO', min: 1, max: 12, def: 1, curve: LIN, step: 1, format: (v) => `×${Math.round(v)}` },
      // Bipolar, as Tone defines it: 0 is a square. Displayed as duty cycle.
      { key: 'width', label: 'WIDTH', min: -0.92, max: 0.92, def: 0, curve: LIN, format: (v) => `${Math.round(((v + 1) / 2) * 100)}` },
      { key: 'sub', label: 'SUB', min: 0, max: 1, def: 0.35, curve: LIN, format: pct },
      { key: 'crush', label: 'CRUSH', min: 0, max: 1, def: 0, curve: LIN, format: pct },
      { key: 'tone', label: 'TONE', min: 240, max: 14000, def: 9000, curve: EXP, unit: 'hz', format: hz },
    ],
    switches: [
      {
        key: 'divisor',
        label: 'DIVISOR',
        def: 2,
        options: [
          { value: 1, label: '÷1' },
          { value: 2, label: '÷2' },
          { value: 3, label: '÷3' },
          { value: 4, label: '÷4' },
        ],
      },
      {
        key: 'series',
        label: 'SERIES',
        def: 'integer',
        options: [
          { value: 'integer', label: 'INT' },
          { value: 'prime', label: 'PRIME' },
        ],
      },
    ],
  },

  // ── II ─────────────────────────────────────────────────────────────────────
  {
    id: 'geometry',
    numeral: 'II',
    name: 'GEOMETRY',
    device: 'THE GNOMON',
    tagline: 'NUMBER IN SPACE',
    blurb: 'A line folded back on itself until it encloses an area.',
    theme: {
      accent: '#63dcff',
      accent2: '#bff1ff',
      glow: 'rgba(99, 220, 255, 0.45)',
      plate: '#07161c',
      plateHi: '#0c2029',
      edge: 'rgba(99, 220, 255, 0.20)',
      edgeStrong: 'rgba(99, 220, 255, 0.44)',
    },
    params: [
      { key: 'pitch', label: 'PITCH', min: 24, max: 1200, def: 146, curve: EXP, unit: 'hz', format: hz },
      { key: 'fold', label: 'FOLD', min: 0, max: 1, def: 0.3, curve: LIN, format: pct },
      { key: 'skew', label: 'SKEW', min: -1, max: 1, def: 0, curve: LIN, format: (v) => v.toFixed(2) },
      { key: 'reso', label: 'RESO', min: 0, max: 1, def: 0.25, curve: LIN, format: pct },
      { key: 'comb', label: 'COMB', min: 0, max: 0.92, def: 0.2, curve: LIN, format: pct },
      { key: 'tone', label: 'TONE', min: 240, max: 14000, def: 7000, curve: EXP, unit: 'hz', format: hz },
    ],
    switches: [
      {
        key: 'sides',
        label: 'SIDES',
        def: 3,
        options: [
          { value: 3, label: 'TRI' },
          { value: 4, label: 'QUAD' },
          { value: 6, label: 'HEX' },
        ],
      },
      {
        key: 'axis',
        label: 'AXIS',
        def: 'unison',
        options: [
          { value: 'unison', label: '1:1' },
          { value: 'octave', label: '2:1' },
          { value: 'fifth', label: '3:2' },
        ],
      },
    ],
  },

  // ── III ────────────────────────────────────────────────────────────────────
  {
    id: 'music',
    numeral: 'III',
    name: 'MUSIC',
    device: 'THE MONOCHORD',
    tagline: 'NUMBER IN TIME',
    blurb: 'One string stopped at a ratio, doubled until it becomes a choir.',
    theme: {
      accent: '#ff7fa8',
      accent2: '#ffc2d5',
      glow: 'rgba(255, 127, 168, 0.45)',
      plate: '#1c0a12',
      plateHi: '#27101a',
      edge: 'rgba(255, 127, 168, 0.20)',
      edgeStrong: 'rgba(255, 127, 168, 0.44)',
    },
    params: [
      { key: 'pitch', label: 'PITCH', min: 40, max: 900, def: 196, curve: EXP, unit: 'hz', format: hz },
      { key: 'spread', label: 'SPREAD', min: 0, max: 40, def: 9, curve: LIN, unit: 'c', format: int },
      { key: 'bloom', label: 'BLOOM', min: 0, max: 1, def: 0.4, curve: LIN, format: pct },
      { key: 'decay', label: 'DECAY', min: 0.4, max: 12, def: 3.5, curve: EXP, step: 0.2, unit: 's', format: (v) => v.toFixed(1) },
      { key: 'hall', label: 'HALL', min: 0, max: 1, def: 0.35, curve: LIN, format: pct },
      { key: 'tone', label: 'TONE', min: 240, max: 14000, def: 5200, curve: EXP, unit: 'hz', format: hz },
    ],
    switches: [
      {
        key: 'interval',
        label: 'INTERVAL',
        def: 'fifth',
        options: [
          { value: 'unison', label: '1:1' },
          { value: 'third', label: '5:4' },
          { value: 'fourth', label: '4:3' },
          { value: 'fifth', label: '3:2' },
        ],
      },
      {
        key: 'temper',
        label: 'TEMPER',
        def: 'just',
        options: [
          { value: 'just', label: 'JUST' },
          { value: 'equal', label: 'EQUAL' },
        ],
      },
    ],
  },

  // ── IV ─────────────────────────────────────────────────────────────────────
  {
    id: 'astronomy',
    numeral: 'IV',
    name: 'ASTRONOMY',
    device: 'THE ORRERY',
    tagline: 'NUMBER IN SPACE AND TIME',
    blurb: 'A band of noise carried slowly around a very large circle.',
    theme: {
      accent: '#b9a3ff',
      accent2: '#e2d8ff',
      glow: 'rgba(185, 163, 255, 0.45)',
      plate: '#0e0b1c',
      plateHi: '#161129',
      edge: 'rgba(185, 163, 255, 0.20)',
      edgeStrong: 'rgba(185, 163, 255, 0.44)',
    },
    params: [
      { key: 'radius', label: 'RADIUS', min: 40, max: 9000, def: 420, curve: EXP, unit: 'hz', format: hz },
      { key: 'aperture', label: 'APERTURE', min: 0.5, max: 24, def: 6, curve: EXP, format: (v) => v.toFixed(1) },
      { key: 'orbit', label: 'ORBIT', min: 0.01, max: 8, def: 0.12, curve: EXP, unit: 'hz', format: (v) => v.toFixed(2) },
      { key: 'drift', label: 'DRIFT', min: 0, max: 1, def: 0.45, curve: LIN, format: pct },
      { key: 'phase', label: 'PHASE', min: 0, max: 1, def: 0.3, curve: LIN, format: pct },
      { key: 'void', label: 'VOID', min: 0, max: 1, def: 0.45, curve: LIN, format: pct },
    ],
    switches: [
      {
        key: 'spectrum',
        label: 'SPECTRUM',
        def: 'pink',
        options: [
          { value: 'white', label: 'WHITE' },
          { value: 'pink', label: 'PINK' },
          { value: 'brown', label: 'BROWN' },
        ],
      },
      {
        key: 'path',
        label: 'PATH',
        def: 'circle',
        options: [
          { value: 'circle', label: 'CIRCLE' },
          { value: 'ellipse', label: 'ELLIPSE' },
          { value: 'comet', label: 'COMET' },
        ],
      },
    ],
  },
]

export const BOX_BY_ID = Object.fromEntries(BOXES.map((b) => [b.id, b]))

/** Transport controls in the header. `format` is supplied by the component. */
export const BPM_DEF = {
  key: 'bpm',
  label: 'TEMPO',
  min: 40,
  max: 260,
  def: 120,
  curve: LIN,
  step: 1,
}

export const MASTER_DEF = {
  key: 'master',
  label: 'MASTER',
  min: 0,
  max: 1,
  def: 0.8,
  curve: LIN,
  unit: 'dB',
}

/** Every box also carries an output level; it lives outside `params`. */
export const LEVEL_DEF = {
  key: 'level',
  label: 'LEVEL',
  min: 0,
  max: 1,
  def: 0.8,
  curve: LIN,
  unit: 'dB',
}

export function defaultParams(box) {
  return Object.fromEntries(box.params.map((p) => [p.key, p.def]))
}

export function defaultSwitches(box) {
  return Object.fromEntries(box.switches.map((s) => [s.key, s.def]))
}

// ── Knob taper helpers ───────────────────────────────────────────────────────

export function paramToNorm(def, value) {
  if (def.curve === EXP) {
    return Math.log(value / def.min) / Math.log(def.max / def.min)
  }
  return (value - def.min) / (def.max - def.min)
}

export function normToParam(def, norm) {
  const n = Math.min(1, Math.max(0, norm))
  let v =
    def.curve === EXP
      ? def.min * Math.pow(def.max / def.min, n)
      : def.min + n * (def.max - def.min)
  if (def.step) v = Math.round(v / def.step) * def.step
  return Math.min(def.max, Math.max(def.min, v))
}
