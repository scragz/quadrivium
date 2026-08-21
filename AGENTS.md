# Quadrivium — Dev Notes

Four themed sound boxes on a shared timeline. Each box is a self-contained
pedal — its own synthesis, its own effect chain, its own faceplate — triggered
by a low-pass gate envelope you place on a sequencer bar. Direction controls
the envelope shape (-1 snappy → 0 ping → +1 swell).

## Stack

- **React 18** (JSX, no TypeScript)
- **Tone.js 15** — Web Audio scheduling, transport, filters
- **Vite 6** — Dev server and build
- **Wrangler 4** — Cloudflare Workers deployment
- **Tailwind 3** — Base layer only; everything is hand-written CSS in `index.css`

## Structure

```
src/
  main.jsx              # React root mount; dev-only window.__quadrivium handle
  App.jsx               # Header (tempo/master/play), rack of four boxes, footer
  index.css             # CSS vars + all component classes
  boxes/
    definitions.js      # THE source of truth: identity, theme, params, switches
  components/
    SoundBox.jsx        # One pedal faceplate
    Knob.jsx            # Rotary control driven by a param definition
    Switch.jsx          # Multi-position slide switch
    Sigil.jsx           # Per-box SVG faceplate marks
    TriggerBar.jsx      # SVG sequencer: click to place, drag to shape, right-click delete
  state/
    useAppState.js      # All app state + callbacks
    persistence.js      # localStorage mirror: save debounced, load validated
  audio/
    engine.js           # AudioEngine + BoxChannel (gate, LPG, limiter, level)
    levels.js           # Gain staging: source normalization, volume taper
    voices/             # One module per box
```

## Adding or changing a control

Add it to that box's `params` (or `switches`) in `boxes/definitions.js`, then
read it in the matching `audio/voices/*.js`. The UI is generated from the
definition — knob taper, stepping, units and value formatting all come from
there, so nothing in the components needs touching.

## Signal chain (per box)

```
voice.sourceOut → gate → LPG (lowpass) → voice.fxIn…fxOut → limiter → level → master → master limiter
```

Effects sit **after** the gate deliberately, so reverb and comb tails ring on
past the envelope the way they would on a real pedal.

A trigger fires `fireTrigger(time, direction, velocity)`, which sweeps the LPG
cutoff and the gate amplitude together:

| direction   | attack | decay | peak cutoff |
|-------------|--------|-------|-------------|
| -1 (snappy) | 5 ms   | 60 ms | 8 kHz       |
| 0 (ping)    | 55 ms  | 200 ms| 10 kHz      |
| +1 (swell)  | 600 ms | 700 ms| 12 kHz      |

Envelopes use `cancelAndHoldAtTime`, so an overlapping trigger retriggers from
wherever the envelope currently sits instead of resetting to zero and clicking.

BPM → bar length: `(60 / BPM) × 4 × 4` (16 beats per loop).

## The four boxes

| # | Box        | Device        | Source                                | Effect              |
|---|------------|---------------|---------------------------------------|---------------------|
| I | Arithmetic | The Monad     | Pulse + integer-divided sub           | Bit crush → tone    |
| II| Geometry   | The Gnomon    | Wavefolded triangle/square/saw        | Tuned comb → reso   |
| III| Music     | The Monochord | 4 oscillators at a just/equal ratio   | Chorus → reverb     |
| IV| Astronomy  | The Orrery    | LFO-swept bandpassed noise            | Phaser → long reverb|

## Keeping the audio thread fed

Tone's transport callbacks run on the **main thread**, a `lookAhead` window
(100 ms by default) before the audio time they schedule for. Anything that
blocks the main thread for longer than that window makes `fireTrigger` run
after its own `time`, and Web Audio answers a ramp scheduled in the past by
jumping straight to the end value — the envelope collapses and you hear a chop.

So: **nothing that runs every animation frame may go through React state.**
The playhead used to, and re-rendering the whole rack 60 times a second kept
the main thread busy ~70% of the time; triggers started landing late and the
audio stuttered within a minute of pressing play. It now lives in
`audio/playhead.js`, a plain subscribe/publish store — `TriggerBar` writes the
line's `x` and the `data-fired` flash attribute straight to the DOM, and no
React render is involved in playback at all.

Two guards back that up: `fireTrigger` clamps its start to
`Tone.getContext().currentTime`, so a late trigger is merely late instead of
broken, and `SoundBox` is memoised, so a knob drag re-renders one pedal rather
than four.

Measured under a 10× CPU throttle, before → after: main thread blocked
2.4–4.2 s out of every 5 s → effectively idle, and triggers arriving up to
60 ms *after* their scheduled time → never later than their schedule, held
steady across a three-minute run.

## Surviving a backgrounded tab

Losing focus used to wreck playback and never give it back. Two separate
browser behaviours, neither of which fixes itself, both handled in
`audio/lifecycle.js`:

**The transport clock gets throttled.** Tone drives the transport from a Web
Worker timer, and a hidden page has its timers throttled — down to roughly one
wake per second. A clock that only wakes once a second cannot see the default
100 ms `lookAhead` window, so every trigger it slept through arrives *past due*,
all in one pass. `fireTrigger` clamped those to `currentTime`, which stacked a
whole window of envelopes onto a single instant, each one cancelling the last
mid-rise: the chopped blat you heard on coming back.

So `lookAhead` widens to 1.2 s while the page is hidden and returns to 0.1 s on
the way back. A slow clock still schedules ahead of the audio, and the pattern
plays through correctly. Shrinking `lookAhead` makes Tone's clock re-dispatch
the ticks it already sent (its `_lastUpdate` moves backwards), but a re-dispatch
here is a no-op — the same trigger at the same audio time just rebuilds an
identical envelope, and the tick order guarantees nothing is left un-scheduled
ahead of the playhead. Verified: no duplicate or missing triggers across a
hide/show cycle.

**The AudioContext gets suspended.** Safari does it on blur, Chrome does it to a
hidden page that has been outputting silence — and this app *is* silent between
triggers, so it qualifies. A suspended context never resumes itself and nothing
here used to ask it to, which is the "never recovers" half. `visibilitychange`,
`focus`, `pageshow` and the context's own `statechange` all route to a resume,
followed by `engine.resync()`.

Backing that up:

- `fireTrigger` **drops** a trigger more than `MAX_LATENESS` (100 ms) past due
  rather than clamping it. Its moment has gone; the loop comes round again.
  Only small slips still clamp.
- The gate's closing ramp can never be skipped: `fireTrigger` catches, slams the
  gate shut and rethrows, so a half-built envelope can't leave a box droning.
- Each transport callback is wrapped, because Tone dispatches every due tick in
  one pass and aborts the whole pass on a throw — one unhappy box would
  otherwise silence the other three for that window.
- `engine.resync()` restarts the playhead rAF (frozen while hidden), rebuilds
  the schedule, republishes the playhead as a discontinuity so `TriggerBar`
  doesn't flash everything it "crossed", and closes any gate left open past its
  own recorded release time — a note still ringing is left alone.

Measured with a main thread blocked 950 ms out of every second (what a
throttled clock looks like to the scheduler): 14 of 15 triggers past due →
after, 16 of 16 dispatched ahead of the audio clock, and a suspend-while-hidden
now comes back to a full 12-triggers-per-loop pattern instead of silence.

## Remembering a session

The patch is mirrored into localStorage under `quadrivium.state.v1` and read
back on load: tempo, master, and per box its knobs, switches, level, bypass and
trigger pattern. `state/persistence.js` owns both halves.

Two things deliberately don't come back:

- **Samples.** A loaded sample is a decoded AudioBuffer behind a `blob:` URL,
  and both die with the document. A restored box is back on its own voice.
- **Playing.** An AudioContext only starts from a user gesture, so a restored
  session always comes up stopped with its patch intact.

Saves are kept off the frame twice over. A knob or trigger drag changes state
once per animation frame, and anything on the main thread competes with the
transport's lookahead window — see "Keeping the audio thread fed". So the save
timer **restarts on every change** (1.5 s), meaning an unbroken drag writes
nothing at all until you let go, and the write then waits for
`requestIdleCallback` rather than landing in whatever the page is doing. A
playing page never really goes idle, so that wait is capped at 2 s.

Measured across a 6-second trigger drag: 13 writes before, 0 after.

That leaves a trailing debounce with no periodic save behind it, so the flush is
what guarantees a save at all — a pending write goes down on `pagehide` and on
the tab going hidden, since a discarded tab may never run another timer, and
leaving mid-drag banks a patch that was never idle long enough to write.

Everything read back is **re-validated against `boxes/definitions.js`** rather
than trusted — numbers clamped to their param's range, switch values checked
against that switch's options, junk triggers dropped. A hand-edited or
half-migrated blob otherwise reaches the audio graph as a NaN, and a NaN in a
Web Audio param throws where it lands rather than where it came from. Anything
unusable (bad JSON, an unknown `version`, no storage at all) falls back to the
seed pattern. A box with *no* stored entry seeds; a box with an empty stored
pattern stays empty — clearing a lane is a decision, not an absence.

localStorage itself is optional: a private window or blocked site data makes
ordinary calls throw, so every access is guarded and the first failure turns
persistence into a no-op rather than taking the app down.

Restoring is a startup step, not a live sync — a second tab keeps its own patch
until whichever one saves last. To start clean, `window.__quadrivium.resetState()`
in a dev build (then reload), or clear the site's storage.

Bumping `SCHEMA_VERSION` discards every stored patch, so reach for it only when
a shape change can't be absorbed by the validators.

## Level calibration

This is the part that will bite you if you skip it. Sources in Web Audio are
wildly mismatched at unit amplitude, so `audio/levels.js` normalizes every
source to a common RMS (`TARGET_RMS`) *before* the gate.

Measured against Tone 15's own generators at 44.1 kHz:

| source                          | RMS    |
|---------------------------------|--------|
| square oscillator               | 0.997  |
| sine / triangle / sawtooth      | 0.707 / 0.577 / 0.575 |
| white noise (raw)               | 0.578  |
| white noise → bandpass 220 Hz Q8 | 0.0255 |

That last row is the trap: a band-passed noise source is **32 dB** below a
square oscillator. `noiseBandRms()` predicts it analytically —
`sigma · sqrt(ENBW / nyquist)` with `ENBW = pi·f0 / 2Q` — verified within 1%
for Q ≤ 8 and 4% at Q = 24, so Astronomy's makeup gain tracks RADIUS and
APERTURE live.

Two more gotchas baked into `levels.js`:

- Tone's `PulseOscillator.width` is **bipolar** (-1..1, 0 = square), not a duty
  cycle. Convert with `widthToDuty()` before `pulseRms()`.
- A pulse at any width but 50% carries DC, and the gate turns that offset into
  a speaker thump. Voices using pulses (or an offset wavefolder) DC-block first.

`FX_MAKEUP` in each voice is a measured constant compensating for that box's
default effect chain. With all four at defaults the spread is ~1.3 dB.

To re-measure: run the dev server, open the console, and use
`window.__quadrivium` (dev builds only) to hold a gate open and tap an
analyser onto `engine.getBox(id).gain`.

## Volume taper

A linear 0..1 gain fader feels broken — 0.5 is only -6 dB, so the top of the
travel does almost nothing. `volumeToGain()` raises position to 2.5, giving a
conventional audio taper that still reaches true silence at 0. Level knobs
display dB rather than a percentage.
