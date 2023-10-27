import { Routes, Route } from 'react-router-dom'
import { IdentityProvider } from './providers/IdentityProvider.tsx'
import CyberspaceViewer from './components/CyberspaceViewer.tsx'
import { Login } from './components/Login'
import { ModalProvider } from './providers/ModalProvider.tsx'
import './scss/App.scss'

function App() {

  return (
    <div id="app">
      <IdentityProvider>
        <ModalProvider>
          <Routes>
            <Route path="/" element={<CyberspaceViewer/>}/>
            <Route path="/login" element={<Login/>}/>
          </Routes>
        </ModalProvider>
      </IdentityProvider>
    </div>
  )
}

export default App