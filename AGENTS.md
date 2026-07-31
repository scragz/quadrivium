# Quadrivium — Dev Notes

Filter-based audio sequencer. Upload samples to lanes, place triggers on a timeline, each trigger fires a filter envelope sweep (attack → peak → decay). Direction parameter (-1 swell / +1 ping) controls the envelope shape.

## Stack

- **React 18** (JSX, no TypeScript)
- **Tone.js 15** — Web Audio scheduling, transport, filters
- **Vite 6** — Dev server and build
- **Wrangler 4** — Cloudflare Workers deployment
- **Tailwind 3** — Only in base CSS; components use inline styles

## Structure
src/
main.jsx              # React root mount
App.jsx               # Layout: header, BPM knob, lane grid, footer
index.css             # CSS vars (colors, font), .knob/.trigger-bar/.upload-btn
components/
Lane.jsx            # Per-lane UI: sample upload, Vol/Q/BaseCutoff knobs
TriggerBar.jsx      # SVG sequencer: click to place, drag to reposition/direction, right-click delete
Knob.jsx            # Vertical-drag rotary control
state/
useAppState.js      # All app state + callbacks; source of truth for lanes/triggers
audio/
engine.js           # Tone.js wrapper: AudioEngine singleton + LaneAudio per lane
## Audio Signal Chain (per lane)
Tone.Player → Tone.Filter (lowpass) → Tone.Gain → Master Gain (0.9) → output
Trigger fires `fireTrigger(time, direction, baseCutoff)` which sweeps the filter:
`baseCutoff → peak → baseCutoff` with attack/decay derived from direction:

| direction | attack | decay | peak  |
|-----------|--------|-------|-------|
| -1 (swell)| 600ms  | 800ms | 6kHz  |
| +1 (ping) | 10ms   | 80ms  | 12kHz |

BPM → bar length: `(60 / BPM) × 4 × 4` (16 beats per loop).
