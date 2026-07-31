import { useCallback, useRef } from 'react'
import { Knob } from './components/Knob.jsx'
import { Lane } from './components/Lane.jsx'
import { useAppState } from './state/useAppState.js'

export default function App() {
  const {
    bpm,
    setBpm,
    playing,
    togglePlay,
    playheadPosition,
    lanes,
    updateLaneSample,
    updateLaneSourceType,
    updateLaneFrequency,
    updateLaneVolume,
    addTrigger,
    updateTrigger,
    cycleVelocity,
    deleteTrigger,
  } = useAppState()

  const lanesRef = useRef(lanes)
  lanesRef.current = lanes

  const handleTogglePlay = useCallback(() => {
    togglePlay(lanesRef.current)
  }, [togglePlay])

  const handleAddTrigger = useCallback((laneId, position) => {
    return addTrigger(laneId, position)
  }, [addTrigger])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <header style={{
        background: 'rgba(10, 10, 18, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        {/* Main header row — wordmark + controls */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
        }}>
          {/* Wordmark */}
          <span style={{
            fontSize: '16px',
            fontFamily: 'var(--font-brand)',
            color: 'var(--text)',
            letterSpacing: '0.34em',
            whiteSpace: 'nowrap',
            textShadow: '0 0 20px rgba(185, 163, 255, 0.35)',
          }}>QUADRIVIUM</span>

          {/* BPM knob */}
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
            <Knob
              label="BPM"
              min={60} max={300}
              value={bpm}
              onChange={setBpm}
              decimals={0}
            />
          </div>

          {/* Play/Stop — icon only */}
          <button
            onClick={handleTogglePlay}
            style={{
              background: playing ? 'var(--accent)' : 'transparent',
              border: `1px solid ${playing ? 'var(--accent)' : 'var(--border-strong)'}`,
              color: playing ? '#0a0a12' : 'var(--text)',
              padding: '8px 12px',
              fontSize: '14px',
              lineHeight: 1,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: playing ? '0 0 16px rgba(185, 163, 255, 0.45)' : 'none',
              flexShrink: 0,
            }}
          >
            {playing ? '■' : '▶'}
          </button>
        </div>
      </header>

      {/* Lanes */}
      <main style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {lanes.map((lane) => (
          <Lane
            key={lane.id}
            lane={lane}
            playheadPosition={playheadPosition}
            onSampleUpload={updateLaneSample}
            onSourceTypeChange={updateLaneSourceType}
            onFrequencyChange={updateLaneFrequency}
            onVolumeChange={updateLaneVolume}
            onAddTrigger={handleAddTrigger}
            onUpdateTrigger={updateTrigger}
            onDeleteTrigger={deleteTrigger}
            onCycleVelocity={cycleVelocity}
          />
        ))}
      </main>

      <footer style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: '9px',
        color: 'var(--text-dim)',
        letterSpacing: '0.30em',
        textAlign: 'center',
        fontFamily: 'var(--font-brand)',
        background: 'var(--hud-bg)',
      }}>
        ARITHMETIC · GEOMETRY · MUSIC · ASTRONOMY
      </footer>
    </div>
  )
}
