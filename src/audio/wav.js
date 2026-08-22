// ─────────────────────────────────────────────────────────────────────────────
// WAV encoding
//
// A rendered loop leaves here as a plain 16-bit PCM RIFF file — the one format
// every DAW, sampler and phone opens without asking questions. The master
// limiter sits at -1 dBFS so the samples arriving here are already inside the
// integer range; the clamp below is a backstop, not a mixing decision.
// ─────────────────────────────────────────────────────────────────────────────

const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
const FORMAT_PCM = 1

/**
 * @param {Float32Array[]} channels one Float32Array per channel, all the same length
 * @param {number} sampleRate
 * @returns {Blob} audio/wav
 */
export function encodeWav(channels, sampleRate) {
  const channelCount = channels.length
  const frames = channels[0]?.length ?? 0
  const blockAlign = channelCount * BYTES_PER_SAMPLE
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // everything after this field
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)            // fmt chunk length
  view.setUint16(20, FORMAT_PCM, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  // Interleaved, channel by channel within each frame.
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      view.setInt16(offset, toPcm16(channels[c][i]), true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * Float sample → signed 16-bit.
 *
 * The negative side of the range reaches one step further than the positive
 * one, so the two halves scale by different amounts; using 32768 for both
 * would clip every full-scale positive peak by a bit.
 */
function toPcm16(sample) {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? s * 0x8000 : s * 0x7fff
}
