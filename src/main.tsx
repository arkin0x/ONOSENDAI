import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'

// A tap on a modal's backdrop only closes it (lib/tapGuard.ts).
installTapGuard(window)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
