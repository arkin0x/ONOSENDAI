import { useContext, useEffect, useRef, useState } from 'react'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion } from 'three'
import { createUnsignedGenesisAction, isGenesisAction } from '../libraries/Cyberspace'
import { publishEvent } from '../libraries/Nostr'
import { Event } from 'nostr-tools'
import { useTelemetry } from '../hooks/cyberspace/useTelemetry'
import { TimestampLive } from './TimestampLive'
import '../scss/Telemetry.scss'
import { countLeadingZeroesHex } from '../libraries/Hash'
import { DraggableCube } from './DraggableCube'

// DEBUG RELAY ONLY
const DEBUG_RELAY = { 'wss://cyberspace.nostr1.com': { read: true, write: true } }

// this dashboard is to visualize the nostr action chain.
export const TelemetryDashboard = () => {
  const [quaternion, setQuaternion] = useState<Quaternion>(new Quaternion(0,0,0,1))

  const { telemetryState, stateIndex, stateLength, changeIndex } = useTelemetry()

  const { actions, position, velocity, rotation, simulationHeight, actionChainState } = telemetryState

  const { identity } = useContext(IdentityContext)

  const { drift, stopDrift, setGenesisAction, setLatestAction } = useEngine(identity.pubkey, DEBUG_RELAY)

  const engineReadyRef = useRef(false)

  useEffect(() => {
    if (actionChainState.status === 'valid') {
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      console.log('updating engine events')
      engineReadyRef.current = true
    } else {
      engineReadyRef.current = false
    }
  }, [actions, position, velocity, rotation, simulationHeight, actionChainState, setGenesisAction, setLatestAction, stateIndex, stateLength])

  function debugActions() {
    const reversedActions = [...actions].reverse()
    return reversedActions.map((action) => {
      return <ActionDOM key={action.id} action={action} />
    })
  }

  function move() {
    // const { created_at, ms_timestamp, ms_only, ms_padded } = getTime()
    // console.log('MOVE', created_at, ms_timestamp, ms_only, ms_padded)
    console.log('move clicked')
    drift(Math.ceil(Math.random() * 5), quaternion)
  }

  async function restart() {
    const genesisAction = createUnsignedGenesisAction(identity.pubkey)
    const genesisActionPublished = await publishEvent(genesisAction, DEBUG_RELAY) // FIXME we would normally pass in `relays` here
    console.warn('Restarting Action Chain with Genesis Action:', genesisActionPublished)
  }

  return (
    <div id="telemetry-dashboard" className="dashboard">
      <div className="panel" id="chain">
        <h1>Action Chain States</h1>
        <p>Each change in the action chain can be stepped through in the order they are received from useCyberspaceStateReconciler.</p>
        <div className="controls">
          { stateIndex > 0 ? <button className="" onClick={() => changeIndex(0)}>Jump to Start</button> : null }
          { stateIndex > 0 ? <button onClick={() => changeIndex(stateIndex - 1)}>Previous</button> : null }
          &nbsp; {stateIndex + 1} / {stateLength}
          &nbsp; { stateIndex + 1 < stateLength ? <button onClick={() => changeIndex(stateIndex + 1)}>Next</button> : null }
          { stateIndex + 1 < stateLength ? <button className="button-glow" onClick={() => changeIndex(stateLength-1)}>Jump to End</button> : null }
        </div>
        <TimestampLive/>
        <div id="chain-events">
          {debugActions()}
        </div>
      </div>
      <div className="panel" id="actions" style={{ "display": "flex" }}>
        <h1>Controls</h1>
        { actionChainState.status === "valid" && stateIndex === stateLength - 1 ? 
        <>
          <button onClick={move}>Move</button>
        </>
        :
        <>
          <div>Engine not ready. { stateIndex + 1 < stateLength ? <button className="button-glow" onClick={() => changeIndex(stateLength-1)}>Jump to End</button> : null }</div> 
          <p>actionChainState: {actionChainState.status}</p>
        </> }
        <br/>
        <h5>Quaternion</h5>
        <DraggableCube quaternion={quaternion} setQuaternion={setQuaternion}/>
        <button onClick={restart}>Restart</button>
      </div>
      <div id="test_calculations">
        <pre>
          &nbsp;
        </pre>
      </div>
    </div>
  )
}

function actionIDColor(id: string) {
  return `#${id.substring(0,6)}`
}

const ActionDOM = ({action}: {action: Event}) => {
  const tags = action.tags.map((tag, index) => {
    return <span key={tag[0] + index} className="tag no-break"><span className="tag-key highlight heavy">{tag[0]}</span> {tag.slice(1).filter(v => v.length > 0).map(str => str.length === 64 && tag[0] !== "C" ? <span className="tag-value heavy" style={{color: actionIDColor(str)}}>{str}</span> : str.length === 64 ? <span className="tag-value">{str}</span> : <span className="tag-value prevent-overflow">{str}</span>)}</span>
  })
  const isGenesis = isGenesisAction(action)
  const pow = countLeadingZeroesHex(action.id)
  const styles = { margin: "1rem", wordWrap: "break-word"} as React.CSSProperties
  return (
    <div key={action.id} className={"event-action" + (isGenesis ? ' genesis' : ' not-genesis')} style={styles}>
      <span className="heavy">
        {action.created_at}<br />
      </span>
      <span className="heavy" style={{ color: actionIDColor(action.id)}}>
        {action.id}
      </span>
      {tags}
      {!isGenesis ? <span className="pow heavy">{pow} POW</span> : null}
    </div>
  );
}