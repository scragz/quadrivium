import * as Tone from 'tone'
import { BoxChannel, barLengthFor, createMasterBus, engine } from './engine.js'
import { voiceTail } from './voices/index.js'
import { encodeWav } from './wav.js'

// ─────────────────────────────────────────────────────────────────────────────
// Offline render
//
// The loop is rebuilt from scratch in an OfflineAudioContext and rendered as
// fast as the machine can manage, rather than captured from the speakers. Same
// voices, same gate, same master bus — `createMasterBus` and `BoxChannel` are
// the engine's own — so the file is what you were listening to, minus every
// dropout, and the tempo, effects and limiting all land identically.
//
// Two things are different from playback, and both are deliberate:
//
// - **No transport.** Every envelope is automation on an AudioParam, and
//   automation can be scheduled arbitrarily far ahead. The whole loop is laid
//   down in one pass before rendering starts, so there is no clock to fall
//   behind and no trigger can arrive late.
// - **The tail wraps.** Reverb and comb tails outlive the bar they were struck
//   in. The render runs past the loop end and folds what is still ringing back
//   onto the start, which is precisely what an infinite repeat of this pattern
//   would sound like — so the file loops seamlessly instead of gating off at
//   the boundary or fading out over a longer, un-loopable file.
//
// Note that `Tone.Offline` swaps the *global* Tone context while it builds the
// graph. The engine captures its own context and transport up front for that
// reason; see audio/engine.js.
// ─────────────────────────────────────────────────────────────────────────────

/** Silence at the head of the render, discarded afterwards.
 *
 * Every control reaches a freshly-built voice as a short ramp (30–100 ms), and
 * a trigger at position 0 would otherwise catch the pitch still gliding up
 * from the constructor's default.
 */
const PRE_ROLL = 0.5

/** The longest gate envelope: 600 ms of attack onto 700 ms of decay. */
const ENVELOPE_TAIL = 1.3

/** Ceiling for the wrapped result, just under full scale. */
const PEAK_CEILING = 0.998

const CHANNEL_COUNT = 2

/**
 * Render the current patch to a WAV blob.
 *
 * @param {{ bpm: number, masterVolume: number, boxes: object[] }} patch
 * @returns {Promise<{ blob: Blob, filename: string, duration: number }>}
 */
export async function exportLoopWav({ bpm, masterVolume, boxes }) {
  const sampleRate = engine.context.sampleRate
  const loopSeconds = barLengthFor(bpm)
  const tailSeconds = tailFor(boxes)

  // Held out here so nothing on the master path is unreferenced while the
  // render runs — the callback's own scope is finished with by then.
  let bus = null

  const rendered = await Tone.Offline(
    async (offline) => {
      bus = createMasterBus(masterVolume)
      const master = bus.master
      const channels = []

      boxes.forEach((box) => {
        // A muted box contributes nothing. Leaving it out of the graph is both
        // exactly right and appreciably faster to render.
        if (box.muted) return

        const channel = new BoxChannel(master, box.id)
        channel.setControls(box.params, box.switches)
        channel.setLevel(box.level)

        // A loaded sample lives in the engine rather than in React state — it
        // is a decoded buffer, not a value — so it is fetched from there.
        const buffer = engine.getBox(box.id)?.buffer
        if (buffer) channel.setBuffer(buffer)

        channel.start(loopSeconds, { sync: false })
        box.triggers.forEach((t) => {
          channel.fireTrigger(
            PRE_ROLL + t.position * loopSeconds,
            t.direction,
            t.velocity ?? 'high'
          )
        })
        channels.push(channel)
      })

      // Reverb impulse responses are rendered, not loaded, and the comb filter
      // is an AudioWorklet — both arrive asynchronously. Start rendering ahead
      // of either and that part of the graph is silent or unconnected.
      await Promise.all(channels.map((c) => c.ready()))
      await offline.workletsAreReady()
      // `workletsAreReady` resolves when the module registers; the node itself
      // is built a microtask later, so yield the turn it needs.
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    PRE_ROLL + loopSeconds + tailSeconds,
    CHANNEL_COUNT,
    sampleRate
  )

  // Rendered; the offline graph can go.
  bus = null

  const channels = foldTail(rendered, sampleRate, loopSeconds)

  return {
    blob: encodeWav(channels, sampleRate),
    filename: filenameFor(bpm),
    duration: loopSeconds,
  }
}

/**
 * How far past the loop end to keep rendering.
 *
 * Long enough for the slowest thing in the rack to fall to silence — anything
 * still ringing when the render stops is simply lost from the wrap.
 */
function tailFor(boxes) {
  let longest = ENVELOPE_TAIL
  boxes.forEach((box) => {
    if (box.muted) return
    longest = Math.max(longest, voiceTail(box.id, box.params) + ENVELOPE_TAIL)
  })
  return longest
}

/**
 * Cut the loop out of the render and wrap what is still ringing back onto it.
 *
 * Summing the overhang modulo the loop length is the periodic summation of the
 * pattern: every tail lands exactly where the next repeat would have put it.
 * A tail longer than the loop itself wraps more than once, which is also what
 * a repeat would do.
 */
function foldTail(rendered, sampleRate, loopSeconds) {
  const preRollFrames = Math.round(PRE_ROLL * sampleRate)
  const loopFrames = Math.round(loopSeconds * sampleRate)
  const tailStart = preRollFrames + loopFrames

  const channels = []
  let peak = 0

  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const src = rendered.getChannelData(c)
    const out = new Float32Array(loopFrames)
    out.set(src.subarray(preRollFrames, tailStart))
    for (let i = tailStart; i < src.length; i++) {
      out[(i - tailStart) % loopFrames] += src[i]
    }
    for (let i = 0; i < loopFrames; i++) {
      const mag = Math.abs(out[i])
      if (mag > peak) peak = mag
    }
    channels.push(out)
  }

  // The wrap adds signal the master limiter never saw, so a peak that sat under
  // the ceiling during playback can land over full scale here. Scale the whole
  // file back rather than clip it — it is a fraction of a dB, and uniform.
  if (peak > PEAK_CEILING) {
    const scale = PEAK_CEILING / peak
    channels.forEach((out) => {
      for (let i = 0; i < out.length; i++) out[i] *= scale
    })
  }

  return channels
}

function filenameFor(bpm) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `quadrivium-${Math.round(bpm)}bpm-${stamp}.wav`
}
