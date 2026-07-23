import { Hud } from './hud/Hud'
import { Scene } from './scene/Scene'
import { useKeyboard } from './hooks/useKeyboard'
import { useProofListener } from './hooks/useProofListener'

export default function App(): JSX.Element {
  useKeyboard()
  useProofListener()

  return (
    <div className="app">
      <Scene />
      <Hud />
    </div>
  )
}
