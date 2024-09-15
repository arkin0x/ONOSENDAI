import { Routes, Route } from 'react-router-dom'
import './scss/App.scss'
import "./scss/Interface.scss"
import "./scss/Dashboard.scss"
import './scss/Home.scss'
import { Logout } from './components/Logout.tsx'
import { Intro } from './components/Intro.tsx'
import { Interface } from './components/Interface.tsx'
import useNDKStore from './store/NDKStore.ts'
import Loading from './components/Loading.tsx'

function App() {

  const { isConnected, isUserLoaded } = useNDKStore()

  if (!isConnected || !isUserLoaded) {
    return <Loading/>
  }

  return (
    <div id="app">
      <Routes>
        <Route path="/" element={<Intro/>}/>
        <Route path="/interface" element={<Interface/>}/>
        <Route path="/logout" element={<Logout/>}/>
      </Routes>
    </div>
  )
}

export default App
