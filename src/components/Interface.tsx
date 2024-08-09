import { useCallback, useContext } from "react"
import { UIState } from "../types/UI"
import { UIContext } from "../providers/UIProvider"
import CyberspaceViewer from "./Cyberspace/CyberspaceViewer"
import { useNavigate } from "react-router-dom"
import CyberspaceMap from "./Map/CyberspaceMap"
import "../scss/Interface.scss"
import "../scss/Dashboard.scss"

export const Interface = () => {
  const navigate = useNavigate()

  const logOut = () => {
    navigate("/logout")
  }

  const { uiState, setUIState } = useContext(UIContext)

  const getInterface = useCallback(() => {
    switch (uiState) {
      case UIState.cyberspace:
        return <CyberspaceViewer />
      case UIState.map:
        return <CyberspaceMap />
      // case UIState.testing:
      //   return <Testing/>
      default:
        break
    }
  }, [uiState])

  return (
    <div id="interface">
      <div id="interface-body">{getInterface()}</div>
      <div id="interface-header">
        <button onClick={() => setUIState(UIState.cyberspace)}>
          Cyberspace
        </button>
        <button onClick={() => setUIState(UIState.map)}>Map</button>
        {/* <button onClick={() => setUIState(UIState.telemetry)}>Telemetry</button> */}
        {/* <button onClick={() => setUIState(UIState.testing)}>Testing</button> */}
        {/* <button onClick={() => setUIState(UIState.settings)}>Settings</button> */}
        {/* <button onClick={() => setUIState(UIState.about)}>About</button> */}
        <button onClick={logOut}>Log Out</button>
      </div>
    </div>
  )
}
