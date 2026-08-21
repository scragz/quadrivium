import { useCallback, useRef } from 'react'
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
    cycleVelocity,
    deleteTrigger,
    clearTriggers,
  } = useAppState()

  const boxesRef = useRef(boxes)
  boxesRef.current = boxes

  const handleTogglePlay = useCallback(() => {
    togglePlay(boxesRef.current)
  }, [togglePlay])

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
