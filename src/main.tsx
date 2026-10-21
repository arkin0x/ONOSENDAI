import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'
import { markBroadcastPage } from './lib/tv/broadcast'

// A tap on a modal's backdrop only closes it (lib/tapGuard.ts).
installTapGuard(window)
// /tv?broadcast=1, the 24/7 stream: no pointer on the page (lib/tv/broadcast.ts).
markBroadcastPage()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
