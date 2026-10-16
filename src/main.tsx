import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'
import { registerOfflineShell } from './offline/register'

// A tap on a modal's backdrop only closes it (lib/tapGuard.ts).
installTapGuard(window)

// The app opens with no network once it has loaded online (offline/sw.js).
registerOfflineShell()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
