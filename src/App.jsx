import { useCallback, useRef } from 'react'
import { ExportButton } from './components/ExportButton.jsx'
import { Knob } from './components/Knob.jsx'
import { SoundBox } from './components/SoundBox.jsx'
import { useAppState } from './state/useAppState.js'
import { BOXES, BPM_DEF, MASTER_DEF } from './boxes/definitions.js'
import { formatVolume } from './audio/levels.js'

const bpmDef = { ...BPM_DEF, format: (v) => `${Math.round(v)}` }
const masterDef = { ...MASTER_DEF, format: formatVolume }

export default function App() {
  const {
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
    liveUpdateTrigger,
    cycleVelocity,
    deleteTrigger,
    clearTriggers,
  } = useAppState()

  // A knob or trigger drag rewrites this on every animation frame, so the
  // callbacks below read it through a ref rather than closing over it — a
  // changing dependency would rebuild them just as often. See AGENTS.md.
  const patchRef = useRef(null)
  patchRef.current = { bpm, masterVolume, boxes }

  const handleTogglePlay = useCallback(() => {
    togglePlay(patchRef.current.boxes)
  }, [togglePlay])

  const getPatch = useCallback(() => patchRef.current, [])

  // Nothing to render: every box is either switched off or has an empty lane.
  const silent = !boxes.some((b) => !b.muted && b.triggers.length > 0)

  return (
    <div className="app">
      <header className="app-header">
        <div className="wordmark">
          <span className="wordmark-text">QUADRIVIUM</span>
          <span className="wordmark-sub">FOUR BOXES · ONE VOID</span>
        </div>

        <div className="transport">
          <Knob def={bpmDef} value={bpm} onChange={setBpm} size={36} />
          <Knob def={masterDef} value={masterVolume} onChange={setMasterVolume} size={36} />
          <ExportButton getPatch={getPatch} disabled={silent} />
          <button
            type="button"
            className={`play ${playing ? 'on' : ''}`}
            onClick={handleTogglePlay}
            aria-label={playing ? 'Stop' : 'Play'}
          >
            {playing ? '■' : '▶'}
          </button>
        </div>
      </header>

      <main className="rack">
        {BOXES.map((def) => {
          const state = boxes.find((b) => b.id === def.id)
          if (!state) return null
          return (
            <SoundBox
              key={def.id}
              def={def}
              state={state}
              onParamChange={setParam}
              onSwitchChange={setSwitch}
              onLevelChange={setLevel}
              onToggleMuted={toggleMuted}
              onSample={setSample}
              onClearSample={clearSample}
              onAddTrigger={addTrigger}
              onUpdateTrigger={updateTrigger}
              onLiveUpdateTrigger={liveUpdateTrigger}
              onDeleteTrigger={deleteTrigger}
              onCycleVelocity={cycleVelocity}
              onClearTriggers={clearTriggers}
            />
          )
        })}
      </main>

      <footer className="app-footer">
        CLICK THE VOID TO PLACE · DRAG UP TO SWELL, DOWN TO SNAP · TAP FOR VELOCITY · RIGHT-CLICK TO ERASE
      </footer>
    </div>
  )
}
