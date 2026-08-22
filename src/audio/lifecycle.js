// Nothing in this app survives a backgrounded tab on its own, so this module
// owns the whole "page went away and came back" story.
//
// Two separate things go wrong when the window loses focus:
//
// 1. The browser throttles timers in a hidden page — worker timers included,
//    and Tone's transport clock is a worker timer. Once it only wakes ~1×/s it
//    can no longer see far enough ahead to schedule anything on time, so every
//    trigger in the window it slept through arrives past due, all at once.
// 2. The browser may suspend the AudioContext outright (Safari on blur, Chrome
//    on a hidden page that has been outputting silence, any browser on an
//    OS-level app switch). A suspended context does not resume itself, and
//    nothing here used to ask it to — so playback stayed dead on return.
//
// The fix for (1) is to widen the scheduling window while hidden so a slow
// clock still schedules ahead of the audio; the fix for (2) is to resume the
// context and then let the engine re-sync itself.
//
// Everything here goes through `engine.context` rather than Tone's global one,
// which an offline render borrows for the length of its setup — see
// audio/render.js.

// lookAhead also sets updateInterval (to half of it) in Tone.
const FOREGROUND_LOOKAHEAD = 0.1
// Survives a clock throttled to one tick per second, which is what Chrome's
// intensive throttling does to a hidden page.
const BACKGROUND_LOOKAHEAD = 1.2

let installed = false

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function setLookAhead(engine, seconds) {
  if (engine.context.lookAhead === seconds) return
  engine.context.lookAhead = seconds
}

/**
 * Ask a suspended context to run again.
 *
 * Only worth doing while the user believes playback is happening — resuming a
 * context nobody asked for is both pointless and, before the first gesture,
 * rejected by the browser. The rejection is expected, not exceptional.
 */
function resumeContext(engine) {
  if (!engine.playing) return
  const context = engine.context
  if (context.rawContext.state === 'running') return
  Promise.resolve(context.resume())
    .then(() => engine.resync())
    .catch(() => {})
}

export function installAudioLifecycle(engine) {
  if (installed) return
  installed = true

  const onHidden = () => {
    // Schedule deeper, so a throttled clock still lands its triggers on time.
    setLookAhead(engine, BACKGROUND_LOOKAHEAD)
  }

  const onVisible = () => {
    setLookAhead(engine, FOREGROUND_LOOKAHEAD)
    resumeContext(engine)
    engine.resync()
  }

  document.addEventListener('visibilitychange', () => {
    if (isHidden()) onHidden()
    else onVisible()
  })

  // Focus and pageshow catch the cases visibilitychange misses: an OS app
  // switch that never marks the page hidden, and a restore from the bfcache.
  window.addEventListener('focus', () => resumeContext(engine))
  window.addEventListener('pageshow', () => {
    if (!isHidden()) onVisible()
  })

  // The context can be suspended out from under us at any time — an OS audio
  // interruption, a device change. Take the state change as the cue.
  engine.context.on('statechange', (state) => {
    if (state !== 'running' && !isHidden()) resumeContext(engine)
  })

  // Apply the right window immediately, in case we loaded into a hidden tab.
  if (isHidden()) onHidden()
}
