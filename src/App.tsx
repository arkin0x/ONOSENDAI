import { Routes, Route } from 'react-router-dom'
import './scss/App.scss'
import "./scss/Interface.scss"
import "./scss/Dashboard.scss"
import './scss/Home.scss'
import { Logout } from './components/Logout.tsx'
import { Intro } from './components/Intro.tsx'
import { Interface } from './components/Interface.tsx'

function App() {

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
