import * as Tone from 'tone'
import { createVoice } from './voices/index.js'
import { volumeToGain } from './levels.js'
import { publishPlayhead } from './playhead.js'

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

// The scheduling window. Tone dispatches a transport callback this far ahead
// of the audio time it schedules for, so it is also the app's whole margin for
// error: anything that keeps the main thread busy for longer lands the trigger
// past due. 0.1 s is Tone's default and what a healthy page runs at; 1.2 s
// survives a clock throttled to one tick per second, which is what a hidden
// tab gets. See audio/lifecycle.js.
//
// Setting it also sets Tone's `updateInterval` (to half of it), so a wide
// window is a slower clock as well as a deeper one — which is why it is given
// back once the page can afford to.
export const FOREGROUND_LOOKAHEAD = 0.1
export const BACKGROUND_LOOKAHEAD = 1.2

// Below this much slack at dispatch, the window is no longer covering whatever
// the main thread is doing and the next stall lands a trigger past due.
const SLACK_FLOOR = 0.02
// Consecutive tight dispatches before widening on slack alone, and the step it
// widens by. A trigger that is actually past due doesn't wait for a run — it
// has already measured the stall, and the window jumps to cover it.
const TIGHTEN_RUN = 2
const WIDEN_STEP = 0.15
// Headroom on top of a measured stall, since the next one is rarely smaller.
const WIDEN_MARGIN = 0.1
// Consecutive comfortable dispatches before giving the window back, and the
// step it gives back by. Slower out than in: re-widening costs a dropped hit.
const RELAX_RUN = 48
const RELAX_STEP = 0.05

// How far past due a trigger may be and still be worth playing. Transport
// callbacks normally arrive a lookahead window *early*; anything meaningfully
// late means the main thread stalled (a hidden tab's throttled clock, a long
// GC) and the transport is now catching up. See fireTrigger.
const MAX_LATENESS = 0.1

/**
 * One box: voice → gate → low-pass gate → voice FX → limiter → level → master.
 *
 * The FX sit after the gate on purpose, so reverb and comb tails ring on past
 * the envelope the way they would on a real pedal.
 */
export class BoxChannel {
  constructor(destination, boxId) {
    this.boxId = boxId
    // Whichever context this channel's nodes were built on. Never re-read from
    // the global: an offline render swaps that out from under a live app —
    // see audio/render.js.
    this.context = Tone.getContext()
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
    // Audio time the last scheduled envelope finishes closing at.
    this.gateCloseAt = 0
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

  /**
   * `sync: false` runs the sample off its own clock instead of the transport —
   * what an offline render needs, since it lays the whole loop out as
   * automation and never starts a transport at all.
   */
  start(loopEnd, { sync = true } = {}) {
    this.voice.start()
    this._stopPlayer()
    if (this.useSample && this.buffer) {
      this.player = new Tone.Player(this.buffer)
      this.player.loop = true
      this.player.loopEnd = Math.min(this.buffer.duration, loopEnd)
      this.player.connect(this.sampleGain)
      if (sync) this.player.sync().start(0)
      else this.player.start(0)
    }
  }

  /**
   * Resolves once the voice's asynchronously-built pieces are in place — the
   * reverb impulse responses, which are rendered rather than loaded. Only an
   * offline render has to wait: in real time they land while the gate is still
   * shut. See audio/voices/index.js.
   */
  ready() {
    return this.voice.ready ? this.voice.ready() : Promise.resolve()
  }

  stop() {
    this.voice.stop()
    this._stopPlayer()
  }

  fireTrigger(time, direction, velocity = 'high') {
    const now = this.context.currentTime

    // A stalled clock hands over every trigger it slept through at once, all of
    // them past due. Clamping them to `now` used to stack a whole window of
    // envelopes on a single instant — each one cancelling the last mid-rise, so
    // what came out was a chopped blat rather than the pattern. A trigger whose
    // moment has properly gone is better dropped: the loop comes round again.
    if (time < now - MAX_LATENESS) return

    // Within the tolerance, clamp instead. Ramping into the past makes Web
    // Audio jump straight to the end value — the envelope collapses and you
    // hear a chop. In the healthy case `time` is still ahead of `now` and
    // nothing shifts.
    const start = Math.max(time, now)

    const { attack, decay, peak } = getTriggerShape(direction)
    const gainPeak = VELOCITY_GAIN[velocity] ?? 1.0
    const release = start + attack + decay

    // Whatever happens below, the gate has to end up closed. An exception
    // between the rise and the fall would leave it wide open — a drone that
    // nothing else in the app ever takes back down.
    this.gateCloseAt = release + 0.008

    try {
      // cancelAndHoldAtTime retriggers from wherever the envelope currently is,
      // instead of the hard reset to zero that used to click on overlapping
      // hits. Read the held value *at* the start time, not at whatever `now`
      // happens to be a lookahead-window earlier.
      const freq = this.lpg.frequency
      freq.cancelAndHoldAtTime(start)
      freq.setValueAtTime(Math.max(freq.getValueAtTime(start), LPG_BASE), start)
      freq.linearRampToValueAtTime(peak, start + attack)
      freq.exponentialRampToValueAtTime(LPG_BASE, release)

      const g = this.gateGain.gain
      g.cancelAndHoldAtTime(start)
      g.setValueAtTime(Math.max(g.getValueAtTime(start), EPSILON), start)
      g.linearRampToValueAtTime(gainPeak, start + attack)
      // Exponential decay reads as a natural fall; the short linear tail after
      // it is what actually reaches silence, since exponentials never do.
      g.exponentialRampToValueAtTime(EPSILON, release)
      g.linearRampToValueAtTime(0, this.gateCloseAt)
    } catch (err) {
      this.panicGate()
      throw err
    }
  }

  /** Slam the gate shut. The recovery path when an envelope was left half-built. */
  panicGate() {
    const now = this.context.currentTime
    try {
      this.gateGain.gain.cancelScheduledValues(now)
      this.gateGain.gain.setValueAtTime(0, now)
      this.lpg.frequency.cancelScheduledValues(now)
      this.lpg.frequency.setValueAtTime(LPG_BASE, now)
    } catch (_) {}
    this.gateCloseAt = 0
  }

  /**
   * Close a gate that is open with nothing left scheduled to close it.
   *
   * Called on the way back from a hidden tab. Comparing against the last
   * envelope's own end time means a note still ringing is left alone — only a
   * genuinely stranded gate gets cut.
   */
  recoverStuckGate() {
    const now = this.context.currentTime
    if (now <= this.gateCloseAt + 0.05) return
    if (this.gateGain.gain.value <= EPSILON) return
    this.gateGain.gain.cancelScheduledValues(now)
    this.gateGain.gain.linearRampToValueAtTime(0, now + 0.02)
    this.lpg.frequency.cancelScheduledValues(now)
    this.lpg.frequency.linearRampToValueAtTime(LPG_BASE, now + 0.02)
    this.gateCloseAt = 0
  }

  resetGate() {
    this.lpg.frequency.cancelScheduledValues(0)
    this.gateGain.gain.cancelScheduledValues(0)
    this.lpg.frequency.rampTo(LPG_BASE, 0.1)
    this.gateGain.gain.rampTo(0, 0.1)
    this.gateCloseAt = 0
  }

  dispose() {
    this.stop()
    this.voice.dispose()
    ;[this.voiceGain, this.sampleGain, this.gateGain, this.lpg, this.limiter, this.gain]
      .forEach((n) => n.dispose())
  }
}

/** Ceiling on the master bus, in dB. */
const MASTER_CEILING = -1

/**
 * Master gain → limiter → output, built on whatever context is current.
 *
 * The offline renderer builds its own, so an exported file leaves through the
 * same chain you were listening through rather than an approximation of it.
 */
export function createMasterBus(volume) {
  // Four boxes hitting at once needs headroom; the limiter is the backstop.
  const master = new Tone.Gain(volumeToGain(volume))
  const limiter = new Tone.Limiter(MASTER_CEILING)
  master.connect(limiter)
  limiter.toDestination()
  // Both nodes come back: a node in the signal path that nothing holds is left
  // to the graph's own lifetime rules, which is not a thing to rely on.
  return { master, limiter }
}

/** One loop is 4 bars of 4 beats. */
export function barLengthFor(bpm) {
  return (60 / bpm) * 4 * 4
}

// Main audio engine
class AudioEngine {
  constructor() {
    // Captured once, rather than read from the global on every call: an
    // offline render swaps the global context for the duration of its setup,
    // and a knob or a play press landing in that window would otherwise
    // address the render's transport instead of this one. See audio/render.js.
    this.context = Tone.getContext()
    this.transport = this.context.transport

    const bus = createMasterBus(0.8)
    this.master = bus.master
    this.masterLimiter = bus.limiter

    this.channels = new Map() // boxId → BoxChannel
    // `${boxId}:${triggerId}` → { id, trigger }. The trigger record is mutable
    // and read at fire time, so a drag can reshape it in place.
    this.scheduledEvents = new Map()
    this._boxesData = []
    this.bpm = 120
    this.barLength = this._calcBarLength(120)
    this.playing = false
    this._rafId = null

    // The scheduling window, as two parts: what the page's visibility asks for
    // and what a struggling clock has had to borrow on top. See _noteDispatch.
    this._baseLookAhead = FOREGROUND_LOOKAHEAD
    this._extraLookAhead = 0
    this._tightRun = 0
    this._comfortableRun = 0
    this._warnedLate = false
  }

  /**
   * Set the window the page's visibility asks for. Anything the engine has
   * borrowed on top of it for a struggling clock is preserved.
   */
  setBaseLookAhead(seconds) {
    this._baseLookAhead = seconds
    this._applyLookAhead()
  }

  _applyLookAhead() {
    const next = Math.min(this._baseLookAhead + this._extraLookAhead, BACKGROUND_LOOKAHEAD)
    if (this.context.lookAhead === next) return
    this.context.lookAhead = next
  }

  /**
   * Widen the scheduling window when triggers start arriving with no slack.
   *
   * A hidden tab gets a wider window because its clock is known to be
   * throttled. A *visible* page had nothing: whatever the cause — a busy
   * machine, a long GC, an occluded window whose timers the browser throttled
   * without ever marking it hidden — the window stayed at 0.1 s while every
   * trigger landed further past due, and `fireTrigger` dropped them one by one.
   * Hits go missing, the ones inside the tolerance clamp and stack, and nothing
   * in the app ever asks for more room.
   *
   * So the dispatch itself is the measurement. Slack running out is the signal
   * to borrow more window, immediately; a long run of comfortable dispatches
   * gives it back in smaller steps, because re-widening costs a dropped hit and
   * a window that is too wide costs nothing but lag on a live edit.
   */
  _noteDispatch(time) {
    const slack = time - this.context.currentTime

    // Past due. However late this one is, is how far short the window fell —
    // so jump straight to covering it. Creeping up in fixed steps costs a
    // handful of dropped hits per step, and the stall is usually still there.
    if (slack < 0) {
      this._tightRun = 0
      this._comfortableRun = 0
      this._widen(this._extraLookAhead - slack + WIDEN_MARGIN)
      return
    }

    // Not late, but with no room to spare: the next stall of any size lands
    // past due. Widen a step at a time, once it has happened twice running.
    if (slack < SLACK_FLOOR) {
      this._comfortableRun = 0
      if (++this._tightRun < TIGHTEN_RUN) return
      this._tightRun = 0
      this._widen(this._extraLookAhead + WIDEN_STEP)
      return
    }

    // Comfortable is measured against the current window, not a fixed number —
    // otherwise a window that has just been widened always looks roomy and the
    // two rules oscillate against each other.
    this._tightRun = 0
    if (this._extraLookAhead <= 0) return
    if (slack < this.context.lookAhead * 0.5) {
      this._comfortableRun = 0
      return
    }
    if (++this._comfortableRun < RELAX_RUN) return
    this._comfortableRun = 0
    this._extraLookAhead = Math.max(0, this._extraLookAhead - RELAX_STEP)
    this._applyLookAhead()
  }

  _widen(extra) {
    const capped = Math.min(extra, BACKGROUND_LOOKAHEAD - this._baseLookAhead)
    if (capped <= this._extraLookAhead) return
    this._extraLookAhead = capped
    this._applyLookAhead()
    if (this._warnedLate) return
    this._warnedLate = true
    console.warn(
      `[quadrivium] triggers arriving without slack; widening the scheduling window to ${this.context.lookAhead.toFixed(2)}s`
    )
  }

  _calcBarLength(bpm) {
    return barLengthFor(bpm)
  }

  setBpm(bpm) {
    this.bpm = bpm
    this.barLength = this._calcBarLength(bpm)
    this.transport.bpm.value = bpm
    if (this.playing) this.transport.loopEnd = this.barLength
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
    this._boxesData = boxesData

    boxesData.forEach((box) => {
      const channel = this.channels.get(box.id)
      if (!channel) return
      // A copy, because the record is mutated in place by a drag and the one
      // React holds is meant to be immutable.
      box.triggers.forEach((trigger) => this._scheduleOne(box.id, channel, { ...trigger }))
    })
  }

  _scheduleOne(boxId, channel, trigger) {
    const eventId = this.transport.schedule((time) => {
      // How much slack this callback arrived with is the only direct read on
      // whether the scheduling window still covers the main thread.
      this._noteDispatch(time)
      // Tone dispatches every tick due in one pass and aborts the whole
      // pass on a throw, so an unhappy box would silence the other three
      // for that window. Contain it here.
      try {
        // Read off `trigger` at fire time, not at schedule time: that is what
        // lets a drag reshape the envelope without rebuilding the schedule.
        channel.fireTrigger(time, trigger.direction, trigger.velocity ?? 'high')
      } catch (err) {
        console.error(`[quadrivium] trigger failed on ${boxId}`, err)
        channel.panicGate()
      }
    }, trigger.position * this.barLength)
    this.scheduledEvents.set(`${boxId}:${trigger.id}`, { id: eventId, trigger })
  }

  /**
   * Edit one trigger that is being dragged, without touching the other eleven.
   *
   * `rescheduleTriggers` tears the whole timeline down and rebuilds it, which
   * is the right thing once per edit but ruinous once per animation frame —
   * measured at 1356 transport events rebuilt across a single two-second drag.
   * Direction and velocity need no rescheduling at all, since the callback
   * reads them at fire time; only a change of position moves the event, and
   * then just that one.
   */
  updateScheduledTrigger(boxId, triggerId, updates) {
    if (!this.playing) return
    const key = `${boxId}:${triggerId}`
    const entry = this.scheduledEvents.get(key)
    if (!entry) return

    const moved = updates.position !== undefined && updates.position !== entry.trigger.position
    Object.assign(entry.trigger, updates)
    if (!moved) return

    const channel = this.channels.get(boxId)
    if (!channel) return
    try { this.transport.clear(entry.id) } catch (_) {}
    this.scheduledEvents.delete(key)
    this._scheduleOne(boxId, channel, entry.trigger)
  }

  _clearScheduled() {
    this.scheduledEvents.forEach(({ id }) => {
      try { this.transport.clear(id) } catch (_) {}
    })
    this.scheduledEvents.clear()
  }

  async start(boxesData) {
    if (this.playing) return
    // Tone.start() resumes the *global* context; this engine owns a specific
    // one, and during an export the two are briefly not the same.
    await this.context.resume()
    const transport = this.transport

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
    this.transport.stop()
    this._clearScheduled()

    this.channels.forEach((channel) => {
      channel.stop()
      channel.resetGate()
    })

    this.playing = false
    this._stopPlayheadRaf()

    // Borrowed window goes back with the transport; the next run starts fresh.
    this._extraLookAhead = 0
    this._tightRun = 0
    this._comfortableRun = 0
    this._warnedLate = false
    this._applyLookAhead()
  }

  rescheduleTriggers(boxesData) {
    if (!this.playing) return
    this._scheduleTriggers(boxesData)
  }

  /**
   * Put the engine back on its feet after the page was away.
   *
   * A hidden tab freezes rAF, may suspend the audio context, and starves the
   * transport clock — so on the way back: pick the playhead loop up again,
   * rebuild the schedule in case the timeline was left mid-catch-up, and close
   * any gate that got stranded open. Safe to call when nothing was wrong.
   */
  resync() {
    if (!this.playing) return
    if (this.context.rawContext.state !== 'running') return

    this._startPlayheadRaf()
    this._scheduleTriggers(this._boxesData)
    this.channels.forEach((channel) => channel.recoverStuckGate())

    // rAF was frozen while we were away, so the playhead's last known position
    // is stale by however long that was. Republish it as a discontinuity so
    // subscribers don't read the jump as "the playhead crossed all of these".
    const pos = this.transport.seconds % this.barLength
    publishPlayhead(pos / this.barLength, true)
  }

  _startPlayheadRaf() {
    if (this._rafId !== null) return
    const tick = () => {
      if (!this.playing) {
        this._rafId = null
        return
      }
      const pos = this.transport.seconds % this.barLength
      publishPlayhead(pos / this.barLength)
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  _stopPlayheadRaf() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    publishPlayhead(0, true)
  }
}

export const engine = new AudioEngine()
