import { useCallback, useRef } from 'react'
import { getContext } from 'tone'
import { Knob } from './Knob.jsx'
import { Switch } from './Switch.jsx'
import { Sigil } from './Sigil.jsx'
import { TriggerBar } from './TriggerBar.jsx'
import { LEVEL_DEF } from '../boxes/definitions.js'
import { formatVolume } from '../audio/levels.js'

const levelDef = { ...LEVEL_DEF, format: formatVolume }

export function SoundBox({
  def,
  state,
  playheadPosition,
  onParamChange,
  onSwitchChange,
  onLevelChange,
  onToggleMuted,
  onSample,
  onClearSample,
  onAddTrigger,
  onUpdateTrigger,
  onDeleteTrigger,
  onCycleVelocity,
  onClearTriggers,
}) {
  const fileRef = useRef(null)
  const { theme } = def

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const decoded = await getContext().rawContext.decodeAudioData(arrayBuffer)
      onSample(def.id, decoded, URL.createObjectURL(file), file.name)
    } catch (err) {
      console.error('Could not decode audio file', err)
    }
    e.target.value = ''
  }, [def.id, onSample])

  const cssVars = {
    '--box-accent': theme.accent,
    '--box-accent-2': theme.accent2,
    '--box-glow': theme.glow,
    '--box-plate': theme.plate,
    '--box-plate-hi': theme.plateHi,
    '--box-edge': theme.edge,
    '--box-edge-strong': theme.edgeStrong,
  }

  return (
    <article className={`box ${state.muted ? 'is-muted' : ''}`} style={cssVars}>
      <span className="screw screw-tl" aria-hidden="true" />
      <span className="screw screw-tr" aria-hidden="true" />
      <span className="screw screw-bl" aria-hidden="true" />
      <span className="screw screw-br" aria-hidden="true" />

      <Sigil boxId={def.id} className="box-sigil" />

      <header className="box-head">
        <div className="box-ident">
          <span className="box-numeral">{def.numeral}</span>
          <div className="box-titles">
            <h2 className="box-name">{def.name}</h2>
            <p className="box-device">{def.device}</p>
          </div>
        </div>

        <div className="box-head-right">
          <span className="box-tagline">{def.tagline}</span>
          <button
            type="button"
            className={`box-power ${state.muted ? '' : 'on'}`}
            onClick={() => onToggleMuted(def.id)}
            aria-pressed={!state.muted}
            title={state.muted ? 'Bypassed — click to engage' : 'Engaged — click to bypass'}
          >
            <span className="box-led" aria-hidden="true" />
            {state.muted ? 'BYP' : 'ON'}
          </button>
        </div>
      </header>

      <div className="box-knobs">
        {def.params.map((p) => (
          <Knob
            key={p.key}
            def={p}
            value={state.params[p.key]}
            onChange={(v) => onParamChange(def.id, p.key, v)}
          />
        ))}
        <span className="knob-divider" aria-hidden="true" />
        <Knob
          def={levelDef}
          value={state.level}
          onChange={(v) => onLevelChange(def.id, v)}
        />
      </div>

      <div className="box-switches">
        {def.switches.map((s) => (
          <Switch
            key={s.key}
            def={s}
            value={state.switches[s.key]}
            onChange={(v) => onSwitchChange(def.id, s.key, v)}
          />
        ))}

        <div className="box-utils">
          {state.sampleName ? (
            <button
              type="button"
              className="chip active"
              onClick={() => onClearSample(def.id)}
              title={`${state.sampleName} — click to return to the box's own voice`}
            >
              ✕ {state.sampleName.slice(0, 14)}
            </button>
          ) : (
            <button
              type="button"
              className="chip"
              onClick={() => fileRef.current?.click()}
              title="Load a sample through this box's effects instead of its oscillator"
            >
              ↑ SMP
            </button>
          )}
          <button
            type="button"
            className="chip"
            onClick={() => onClearTriggers(def.id)}
            title="Clear this box's triggers"
          >
            CLR
          </button>
        </div>
      </div>

      <TriggerBar
        laneId={def.id}
        triggers={state.triggers}
        playheadPosition={playheadPosition}
        accent={theme.accent}
        accent2={theme.accent2}
        onAdd={onAddTrigger}
        onUpdate={onUpdateTrigger}
        onDelete={onDeleteTrigger}
        onCycleVelocity={onCycleVelocity}
      />

      <p className="box-blurb">{def.blurb}</p>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </article>
  )
}
