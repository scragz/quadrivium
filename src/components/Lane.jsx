import { useCallback, useRef } from 'react'
import { getContext } from 'tone'
import { Knob } from './Knob.jsx'
import { TriggerBar } from './TriggerBar.jsx'

export function Lane({
  lane,
  playheadPosition,
  onSampleUpload,
  onSourceTypeChange,
  onFrequencyChange,
  onVolumeChange,
  onAddTrigger,
  onUpdateTrigger,
  onDeleteTrigger,
  onCycleVelocity,
}) {
  const fileRef = useRef(null)

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const arrayBuffer = await file.arrayBuffer()
    const ctx = getContext().rawContext
    const decoded = await ctx.decodeAudioData(arrayBuffer)
    onSampleUpload(lane.id, decoded, url)
    e.target.value = ''
  }, [lane.id, onSampleUpload])

  const sampleName = lane.sampleUrl
    ? lane.sampleUrl.split('/').pop()?.substring(0, 14) || 'sample'
    : null

  const hasFreq = lane.sourceType === 'tone' || lane.sourceType === 'noise'

  return (
    <div style={{
      background: 'linear-gradient(180deg, var(--surface-alt), var(--surface))',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '10px 12px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
      boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 2px 12px rgba(0,0,0,0.35)',
    }}>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>

        {/* Source section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {/* Source type selector */}
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              className={`source-pill ${lane.sourceType === 'noise' ? 'active' : ''}`}
              onClick={() => onSourceTypeChange(lane.id, 'noise')}
              title="White noise through bandpass + LPG"
            >noise</button>
            <button
              className={`source-pill ${lane.sourceType === 'tone' ? 'active' : ''}`}
              onClick={() => onSourceTypeChange(lane.id, 'tone')}
              title="Square oscillator through LPG"
            >tone</button>
            <button
              className={`source-pill ${lane.sourceType === 'sample' ? 'active' : ''}`}
              onClick={() => fileRef.current?.click()}
              title={sampleName ? 'Click to replace sample' : 'Upload a sample'}
            >{sampleName || '↑ smp'}</button>
          </div>
        </div>

        {/* Knobs */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <Knob
            label="Vol"
            min={0} max={1}
            value={lane.volume}
            onChange={v => onVolumeChange(lane.id, v)}
            decimals={2}
          />
          {hasFreq && (
            <Knob
              label="Freq"
              min={20} max={2000}
              value={lane.frequency}
              onChange={v => onFrequencyChange(lane.id, v)}
              decimals={0}
              unit="hz"
            />
          )}
        </div>
      </div>

      {/* Trigger bar */}
      <TriggerBar
        laneId={lane.id}
        triggers={lane.triggers}
        playheadPosition={playheadPosition}
        onAdd={onAddTrigger}
        onUpdate={onUpdateTrigger}
        onDelete={onDeleteTrigger}
        onCycleVelocity={onCycleVelocity}
      />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
