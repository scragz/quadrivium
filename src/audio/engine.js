import * as Tone from 'tone'
import { createVoice } from './voices/index.js'
import { volumeToGain } from './levels.js'

// Derive trigger envelope params from direction (-1 snappy → 0 neutral/ping → +1 swell)
// Neutral (direction=0) is an LPG-style ping: fast attack, short-ish decay.
// Up (+1) builds into a long swell. Down (-1) is super snappy.
export function getTriggerShape(direction) {
  const t = (direction + 1) / 2 // 0.0 (snappy) → 1.0 (swell)

  // Exponential interpolation keeps neutral feeling like a ping, not a blob
  // attack: ~5ms (snappy) → ~55ms (neutral) → 600ms (full swell)
  const attack = 0.005 * Math.pow(120, t)
  // decay:  ~60ms (snappy) → ~200ms (neutral) → 700ms (full swell)
  const decay = 0.06 * Math.pow(11.67, t)
  // peak cutoff: 8kHz (snappy) → 10kHz (neutral) → 12kHz (swell)
  const peak = lerp(8000, 12000, t)

  return { attack, decay, peak }
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

const VELOCITY_GAIN = { high: 1.0, med: 0.5, low: 0.2 }

// LPG resting frequency (gate closed position)
const LPG_BASE = 70
// Floor for exponential ramps — WebAudio can't ramp to or through zero.
const EPSILON = 1e-4

/**
 * One box: voice → gate → low-pass gate → voice FX → limiter → level → master.
 *
 * The FX sit after the gate on purpose, so reverb and comb tails ring on past
 * the envelope the way they would on a real pedal.
 */
class BoxChannel {
  constructor(destination, boxId) {
    this.boxId = boxId
    this.voice = createVoice(boxId)

    this.voiceGain = new Tone.Gain(1)   // voice source, muted when a sample loads
    this.sampleGain = new Tone.Gain(0)  // uploaded sample, if any
    this.gateGain = new Tone.Gain(0)    // amplitude gate, starts silent
    this.lpg = new Tone.Filter({ type: 'lowpass', frequency: LPG_BASE, Q: 1.2 })
    // Catches what the analytic trims can't predict: wavefolding, bit crush
    // and resonance all add level in ways that depend on the input.
    this.limiter = new Tone.Limiter(-3)
    this.gain = new Tone.Gain(volumeToGain(0.8))

    this.voice.sourceOut.connect(this.voiceGain)
    this.voiceGain.connect(this.gateGain)
    this.sampleGain.connect(this.gateGain)
    this.gateGain.connect(this.lpg)
    this.lpg.connect(this.voice.fxIn)
    this.voice.fxOut.connect(this.limiter)
    this.limiter.connect(this.gain)
    this.gain.connect(destination)

    this.player = null
    this.buffer = null
    this.useSample = false
    this.muted = false
    this.level = 0.8
  }

  setControls(params, switches) {
    this.voice.set(params, switches)
  }

  setLevel(position) {
    this.level = position
    if (!this.muted) this.gain.gain.rampTo(volumeToGain(position), 0.05)
  }

  setMuted(muted) {
    this.muted = muted
    this.gain.gain.rampTo(muted ? 0 : volumeToGain(this.level), 0.04)
  }

  setBuffer(audioBuffer) {
    this.buffer = audioBuffer
    this.useSample = !!audioBuffer
    this.voiceGain.gain.rampTo(this.useSample ? 0 : 1, 0.05)
    this.sampleGain.gain.rampTo(this.useSample ? 1 : 0, 0.05)
  }

  clearBuffer() {
    this.buffer = null
    this.useSample = false
    this._stopPlayer()
    this.voiceGain.gain.rampTo(1, 0.05)
    this.sampleGain.gain.rampTo(0, 0.05)
  }

  _stopPlayer() {
    if (!this.player) return
    try { this.player.unsync() } catch (_) {}
    try { this.player.stop() } catch (_) {}
    this.player.dispose()
    this.player = null
  }

  start(loopEnd) {
    this.voice.start()
    this._stopPlayer()
    if (this.useSample && this.buffer) {
      this.player = new Tone.Player(this.buffer)
      this.player.loop = true
      this.player.loopEnd = Math.min(this.buffer.duration, loopEnd)
      this.player.connect(this.sampleGain)
      this.player.sync().start(0)
    }
  }

  stop() {
    this.voice.stop()
    this._stopPlayer()
  }

  fireTrigger(time, direction, velocity = 'high') {
    const { attack, decay, peak } = getTriggerShape(direction)
    const gainPeak = VELOCITY_GAIN[velocity] ?? 1.0
    const release = time + attack + decay

    // cancelAndHoldAtTime retriggers from wherever the envelope currently is,
    // instead of the hard reset to zero that used to click on overlapping hits.
    const freq = this.lpg.frequency
    freq.cancelAndHoldAtTime(time)
    freq.setValueAtTime(Math.max(freq.value, LPG_BASE), time)
    freq.linearRampToValueAtTime(peak, time + attack)
    freq.exponentialRampToValueAtTime(LPG_BASE, release)

    const g = this.gateGain.gain
    g.cancelAndHoldAtTime(time)
    g.setValueAtTime(Math.max(g.value, EPSILON), time)
    g.linearRampToValueAtTime(gainPeak, time + attack)
    // Exponential decay reads as a natural fall; the short linear tail after it
    // is what actually reaches silence, since exponentials never do.
    g.exponentialRampToValueAtTime(EPSILON, release)
    g.linearRampToValueAtTime(0, release + 0.008)
  }

  resetGate() {
    this.lpg.frequency.cancelScheduledValues(0)
    this.gateGain.gain.cancelScheduledValues(0)
    this.lpg.frequency.rampTo(LPG_BASE, 0.1)
    this.gateGain.gain.rampTo(0, 0.1)
  }

  dispose() {
    this.stop()
    this.voice.dispose()
    ;[this.voiceGain, this.sampleGain, this.gateGain, this.lpg, this.limiter, this.gain]
      .forEach((n) => n.dispose())
  }
}

// Main audio engine
class AudioEngine {
  constructor() {
    // Four boxes hitting at once needs headroom; the limiter is the backstop.
    this.master = new Tone.Gain(volumeToGain(0.8))
    this.masterLimiter = new Tone.Limiter(-1)
    this.master.connect(this.masterLimiter)
    this.masterLimiter.toDestination()

    this.channels = new Map() // boxId → BoxChannel
    this.scheduledEvents = []
    this.bpm = 120
    this.barLength = this._calcBarLength(120)
    this.playing = false
    this._onPlayhead = null
    this._rafId = null
  }

  _calcBarLength(bpm) {
    // 4 bars × 4 beats
    return (60 / bpm) * 4 * 4
  }

  setBpm(bpm) {
    this.bpm = bpm
    this.barLength = this._calcBarLength(bpm)
    const transport = Tone.getTransport()
    transport.bpm.value = bpm
    if (this.playing) transport.loopEnd = this.barLength
  }

  setMasterVolume(position) {
    this.master.gain.rampTo(volumeToGain(position), 0.05)
  }

  addBox(id) {
    if (!this.channels.has(id)) {
      this.channels.set(id, new BoxChannel(this.master, id))
    }
  }

  getBox(id) {
    return this.channels.get(id)
  }

  setBoxControls(id, params, switches) {
    this.channels.get(id)?.setControls(params, switches)
  }

  setBoxLevel(id, position) {
    this.channels.get(id)?.setLevel(position)
  }

  setBoxMuted(id, muted) {
    this.channels.get(id)?.setMuted(muted)
  }

  setBoxBuffer(id, audioBuffer) {
    const channel = this.channels.get(id)
    if (!channel) return
    channel.setBuffer(audioBuffer)
    if (this.playing) channel.start(this.barLength)
  }

  clearBoxBuffer(id) {
    this.channels.get(id)?.clearBuffer()
  }

  // Schedule all triggers for the boxes
  _scheduleTriggers(boxesData) {
    this._clearScheduled()

    const transport = Tone.getTransport()

    boxesData.forEach((box) => {
      const channel = this.channels.get(box.id)
      if (!channel) return

      box.triggers.forEach((trigger) => {
        const triggerTime = trigger.position * this.barLength
        const eventId = transport.schedule((time) => {
          channel.fireTrigger(time, trigger.direction, trigger.velocity ?? 'high')
        }, triggerTime)
        this.scheduledEvents.push(eventId)
      })
    })
  }

  _clearScheduled() {
    const transport = Tone.getTransport()
    this.scheduledEvents.forEach((id) => {
      try { transport.clear(id) } catch (_) {}
    })
    this.scheduledEvents = []
  }

  async start(boxesData) {
    await Tone.start()
    const transport = Tone.getTransport()

    transport.bpm.value = this.bpm
    transport.loop = true
    transport.loopStart = 0
    transport.loopEnd = this.barLength

    this.channels.forEach((channel) => channel.start(this.barLength))

    this._scheduleTriggers(boxesData)
    transport.start()
    this.playing = true
    this._startPlayheadRaf()
  }

  stop() {
    const transport = Tone.getTransport()
    transport.stop()
    this._clearScheduled()

    this.channels.forEach((channel) => {
      channel.stop()
      channel.resetGate()
    })

    this.playing = false
    this._stopPlayheadRaf()
  }

  rescheduleTriggers(boxesData) {
    if (!this.playing) return
    this._scheduleTriggers(boxesData)
  }

  onPlayhead(cb) {
    this._onPlayhead = cb
  }

  _startPlayheadRaf() {
    const tick = () => {
      if (!this.playing) return
      const transport = Tone.getTransport()
      const pos = transport.seconds % this.barLength
      this._onPlayhead?.(pos / this.barLength)
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  _stopPlayheadRaf() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    this._onPlayhead?.(0)
  }
}

export const engine = new AudioEngine()
