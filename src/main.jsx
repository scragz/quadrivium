import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Tone from 'tone'
import App from './App.jsx'
import './index.css'
import { engine } from './audio/engine.js'
import { exportLoopWav } from './audio/render.js'
import { installAudioLifecycle } from './audio/lifecycle.js'
import { clearPersistedState } from './state/persistence.js'

// A backgrounded tab throttles the transport clock and can suspend the audio
// context outright; neither fixes itself. See audio/lifecycle.js.
installAudioLifecycle(engine)

// Dev-only handle for poking at the audio graph from the console — level
// checks, forcing a gate open, inspecting a voice's nodes. `resetState()`
// drops the saved patch; reload to come back up on the seed pattern.
// `exportLoopWav()` renders an arbitrary patch offline without going through
// the button, which is how the render is measured.
if (import.meta.env.DEV) {
  window.__quadrivium = { engine, Tone, resetState: clearPersistedState, exportLoopWav }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
