import { Routes, Route } from 'react-router-dom'
import './scss/App.scss'
import "./scss/Interface.scss"
import "./scss/Dashboard.scss"
import './scss/Home.scss'
import { Intro } from './components/Intro.tsx'

function App() {

  return (
    <div id="app">
      <Routes>
        <Route path="*" element={<Intro/>}/>
      </Routes>
    </div>
  )
}

export default App
