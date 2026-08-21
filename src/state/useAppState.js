import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { engine } from '../audio/engine.js'
import { BOXES, LEVEL_DEF, defaultParams, defaultSwitches } from '../boxes/definitions.js'

const VELOCITY_ORDER = ['high', 'med', 'low']

// A starting pattern per box, so the thing makes sound the moment you hit play.
// direction: -1 snappy … +1 swell.
const SEED_TRIGGERS = {
  arithmetic: [
    { position: 0.0, direction: -0.7 },
    { position: 0.25, direction: -0.9, velocity: 'med' },
    { position: 0.5, direction: -0.7 },
    { position: 0.75, direction: -0.9, velocity: 'low' },
  ],
  geometry: [
    { position: 0.125, direction: 0.1 },
    { position: 0.375, direction: -0.4, velocity: 'med' },
    { position: 0.625, direction: 0.1 },
    { position: 0.875, direction: -0.4, velocity: 'med' },
  ],
  music: [
    { position: 0.0, direction: 0.85 },
    { position: 0.5, direction: 0.6, velocity: 'med' },
  ],
  astronomy: [
    { position: 0.06, direction: 1.0 },
    { position: 0.66, direction: 0.9, velocity: 'med' },
  ],
}

function initialBoxes() {
  return BOXES.map((box) => ({
    id: box.id,
    params: defaultParams(box),
    switches: defaultSwitches(box),
    level: LEVEL_DEF.def,
    muted: false,
    sampleUrl: null,
    sampleName: null,
    triggers: (SEED_TRIGGERS[box.id] ?? []).map((t) => ({
      id: uuidv4(),
      velocity: 'high',
      ...t,
    })),
  }))
}

export function useAppState() {
  const [bpm, setBpmState] = useState(120)
  const [masterVolume, setMasterVolumeState] = useState(0.8)
  const [playing, setPlaying] = useState(false)
  const [boxes, setBoxes] = useState(initialBoxes)
  const initialized = useRef(false)
  const boxesRef = useRef(boxes)
  boxesRef.current = boxes

  if (!initialized.current) {
    initialized.current = true
    BOXES.forEach((b) => engine.addBox(b.id))
  }

  // Push every control snapshot to the engine whenever a box changes. Voices
  // apply values as short ramps, so this stays smooth under a knob drag.
  useEffect(() => {
    boxes.forEach((b) => engine.setBoxControls(b.id, b.params, b.switches))
  }, [boxes])

  const setBpm = useCallback((val) => {
    setBpmState(val)
    engine.setBpm(val)
  }, [])

  const setMasterVolume = useCallback((val) => {
    setMasterVolumeState(val)
    engine.setMasterVolume(val)
  }, [])

  const togglePlay = useCallback(async (currentBoxes) => {
    if (playing) {
      engine.stop()
      setPlaying(false)
    } else {
      await engine.start(currentBoxes)
      setPlaying(true)
    }
  }, [playing])

  const patchBox = useCallback((boxId, updater) => {
    setBoxes((prev) => prev.map((b) => (b.id === boxId ? updater(b) : b)))
  }, [])

  // ── Box controls ───────────────────────────────────────────────────────────

  const setParam = useCallback((boxId, key, value) => {
    patchBox(boxId, (b) => ({ ...b, params: { ...b.params, [key]: value } }))
  }, [patchBox])

  const setSwitch = useCallback((boxId, key, value) => {
    patchBox(boxId, (b) => ({ ...b, switches: { ...b.switches, [key]: value } }))
  }, [patchBox])

  const setLevel = useCallback((boxId, value) => {
    patchBox(boxId, (b) => ({ ...b, level: value }))
    engine.setBoxLevel(boxId, value)
  }, [patchBox])

  const toggleMuted = useCallback((boxId) => {
    setBoxes((prev) => prev.map((b) => {
      if (b.id !== boxId) return b
      const muted = !b.muted
      engine.setBoxMuted(boxId, muted)
      return { ...b, muted }
    }))
  }, [])

  const setSample = useCallback((boxId, buffer, url, name) => {
    patchBox(boxId, (b) => ({ ...b, sampleUrl: url, sampleName: name }))
    engine.setBoxBuffer(boxId, buffer)
  }, [patchBox])

  const clearSample = useCallback((boxId) => {
    patchBox(boxId, (b) => {
      if (b.sampleUrl) URL.revokeObjectURL(b.sampleUrl)
      return { ...b, sampleUrl: null, sampleName: null }
    })
    engine.clearBoxBuffer(boxId)
  }, [patchBox])

  // Rescheduling tears down and rebuilds every transport event, so key it on
  // the triggers alone — a knob drag must not churn the schedule 60x a second.
  const triggerKey = useMemo(
    () =>
      boxes
        .map((b) =>
          b.triggers
            .map((t) => `${t.position.toFixed(5)}|${t.direction.toFixed(4)}|${t.velocity}`)
            .join(',')
        )
        .join(';'),
    [boxes]
  )

  useEffect(() => {
    engine.rescheduleTriggers(boxesRef.current)
  }, [triggerKey])

  // ── Trigger mutations ──────────────────────────────────────────────────────

  const addTrigger = useCallback((boxId, position) => {
    const newTrigger = { id: uuidv4(), position, direction: 0, velocity: 'high' }
    patchBox(boxId, (b) => ({ ...b, triggers: [...b.triggers, newTrigger] }))
    return newTrigger.id
  }, [patchBox])

  const updateTrigger = useCallback((boxId, triggerId, updates) => {
    patchBox(boxId, (b) => ({
      ...b,
      triggers: b.triggers.map((t) => (t.id === triggerId ? { ...t, ...updates } : t)),
    }))
  }, [patchBox])

  const cycleVelocity = useCallback((boxId, triggerId) => {
    patchBox(boxId, (b) => ({
      ...b,
      triggers: b.triggers.map((t) => {
        if (t.id !== triggerId) return t
        const idx = VELOCITY_ORDER.indexOf(t.velocity ?? 'high')
        return { ...t, velocity: VELOCITY_ORDER[(idx + 1) % VELOCITY_ORDER.length] }
      }),
    }))
  }, [patchBox])

  const deleteTrigger = useCallback((boxId, triggerId) => {
    patchBox(boxId, (b) => ({ ...b, triggers: b.triggers.filter((t) => t.id !== triggerId) }))
  }, [patchBox])

  const clearTriggers = useCallback((boxId) => {
    patchBox(boxId, (b) => ({ ...b, triggers: [] }))
  }, [patchBox])

  return {
    bpm,
    setBpm,
    masterVolume,
    setMasterVolume,
    playing,
    togglePlay,
    boxes,
    setParam,
    setSwitch,
    setLevel,
    toggleMuted,
    setSample,
    clearSample,
    addTrigger,
    updateTrigger,
    cycleVelocity,
    deleteTrigger,
    clearTriggers,
  }
}
