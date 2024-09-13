import { Routes, Route } from 'react-router-dom'
import { IdentityProvider } from './providers/IdentityProvider.tsx'
import { ModalProvider } from './providers/ModalProvider.tsx'
import { Home } from './components/Home.tsx'
import './scss/App.scss'
import { UIProvider } from './providers/UIProvider.tsx'
import { Logout } from './components/Logout.tsx'
import NDKProvider from './providers/NDKProvider.tsx'

function App() {

  return (
    <div id="app">
      <NDKProvider>
        <UIProvider>
          <ModalProvider>
            <Routes>
              <Route path="/" element={<Home/>}/>
              <Route path="/logout" element={<Logout/>}/>
            </Routes>
          </ModalProvider>
        </UIProvider>
      </NDKProvider>
    </div>
  )
}

export default App
