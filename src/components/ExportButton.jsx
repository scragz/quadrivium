import { useCallback, useEffect, useState } from 'react'
import { exportLoopWav } from '../audio/render.js'

// How long a failure stays on the button before it offers itself again.
const ERROR_LINGER = 3000

const LABEL = {
  idle: '↓ WAV',
  working: 'RENDER',
  error: 'FAILED',
}

/**
 * Renders the current loop offline and hands it over as a .wav download.
 *
 * The patch arrives through a getter rather than as props: a knob drag changes
 * the rack on every animation frame, and nothing that happens at that rate may
 * cause a React render while the transport is running. See AGENTS.md.
 */
export function ExportButton({ getPatch, disabled }) {
  const [status, setStatus] = useState('idle')
  const working = status === 'working'

  useEffect(() => {
    if (status !== 'error') return undefined
    const timer = setTimeout(() => setStatus('idle'), ERROR_LINGER)
    return () => clearTimeout(timer)
  }, [status])

  const onClick = useCallback(async () => {
    if (working) return
    setStatus('working')
    try {
      const { blob, filename } = await exportLoopWav(getPatch())
      downloadBlob(blob, filename)
      setStatus('idle')
    } catch (err) {
      console.error('[quadrivium] export failed', err)
      setStatus('error')
    }
  }, [working, getPatch])

  return (
    <button
      type="button"
      className={`play export ${status}`}
      onClick={onClick}
      disabled={disabled || working}
      aria-busy={working}
      title={
        disabled
          ? 'Place a trigger on a box that is switched on, then export'
          : 'Render this loop to a WAV file. The tail wraps around, so it loops seamlessly.'
      }
    >
      {LABEL[status]}
    </button>
  )
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking straight away can outrun the browser's own read of the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
