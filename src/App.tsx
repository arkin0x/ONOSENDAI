import { Routes, Route } from 'react-router-dom'
import { IdentityProvider } from './providers/IdentityProvider.tsx'
import { Login } from './components/Login'
import { ModalProvider } from './providers/ModalProvider.tsx'
import { Home } from './components/Home.tsx'
import './scss/App.scss'
import { UIProvider } from './providers/UIProvider.tsx'
import { Logout } from './components/Logout.tsx'
import { NDKProvider } from './providers/NDKProvider.tsx'

function App() {

  return (
    <div id="app">
      <NDKProvider>
        <IdentityProvider>
          <UIProvider>
            <ModalProvider>
              <Routes>
                <Route path="/" element={<Home/>}/>
                <Route path="/login" element={<Login/>}/>
                <Route path="/logout" element={<Logout/>}/>
              </Routes>
            </ModalProvider>
          </UIProvider>
        </IdentityProvider>
      </NDKProvider>
    </div>
  )
}

export default App
