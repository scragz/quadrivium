import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Tone from 'tone'
import App from './App.jsx'
import './index.css'
import { engine } from './audio/engine.js'

// Dev-only handle for poking at the audio graph from the console — level
// checks, forcing a gate open, inspecting a voice's nodes.
if (import.meta.env.DEV) {
  window.__quadrivium = { engine, Tone }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
