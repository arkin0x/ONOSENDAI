import { useCallback, useContext } from "react"
import { TelemetryDashboard } from "./TelemetryDashboard"
import { UIState } from "../types/UI"
import CyberspaceViewer from "./CyberspaceViewer"
import { UIContext } from "../providers/UIProvider"
import '../scss/Dashboard.scss'
import { useNavigate } from "react-router-dom"
import { Testing } from "./Testing"

export const Interface = () => {

  const navigate = useNavigate()
  const logOut = () => {
    navigate('/logout')
  }

  const { uiState, setUIState } = useContext(UIContext)

  const getInterface = useCallback(() => {
    switch (uiState) {
      case UIState.cyberspace:
        return <CyberspaceViewer/>
      case UIState.telemetry:
        return <TelemetryDashboard/>
      case UIState.testing:
        return <Testing/>
      default:
        break
    }
  }, [uiState])

  return (
    <div id="interface">
      <div id="interface-header">
        <button onClick={() => setUIState(UIState.cyberspace)}>Cyberspace</button>
        <button onClick={() => setUIState(UIState.telemetry)}>Telemetry</button>
        <button onClick={() => setUIState(UIState.testing)}>Testing</button>
        <button onClick={() => setUIState(UIState.settings)}>Settings</button>
        <button onClick={() => setUIState(UIState.about)}>About</button>
        <button onClick={logOut}>Log Out</button>
      </div>
      <div id="interface-body">
        {getInterface()}
      </div>
    </div>
  )

}
