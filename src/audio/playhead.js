// The playhead moves every animation frame. Routing that through React state
// re-rendered the whole rack 60 times a second, which saturated the main
// thread — and Tone's transport callbacks run on that same thread, so triggers
// started arriving after their own scheduled audio time and the envelopes
// chopped. The position lives here instead, and subscribers write it straight
// to the DOM.
//
// Subscribers are called as fn(position, reset). `reset` marks a discontinuity
// (transport stopped, first call on subscribe) so they can skip the
// "which triggers did we just cross?" test rather than firing spuriously.

const subscribers = new Set()
let position = 0

export function publishPlayhead(pos, reset = false) {
  position = pos
  subscribers.forEach((fn) => fn(pos, reset))
}

export function subscribePlayhead(fn) {
  subscribers.add(fn)
  fn(position, true)
  return () => subscribers.delete(fn)
}
