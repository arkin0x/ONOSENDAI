import { useContext, useEffect, useRef, useState } from 'react'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion } from 'three'
import { createUnsignedGenesisAction, isGenesisAction } from '../libraries/Cyberspace'
import { getTag, publishEvent } from '../libraries/Nostr'
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

  const [autoNext, setAutoNext] = useState(true)

  useEffect(() => {
    if (actionChainState.status === 'valid') {
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      console.log('updating engine events')
      engineReadyRef.current = true
    } else {
      engineReadyRef.current = false
    }
    if (autoNext && stateIndex < stateLength - 1) {
      changeIndex(stateLength-1)
      move()
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
    if (Math.abs(quaternion.x) > 0.0001) {
      setQuaternion(new Quaternion(0,0,0,1))
    } else {
      setQuaternion(new Quaternion(quaternion.x + Math.random() / 100000, quaternion.y + Math.random() / 10000, quaternion.z + Math.random() / 10000, quaternion.w + Math.random() / 10000))
    }
    // drift(Math.ceil(Math.random() * 5), quaternion)
    drift(15, quaternion)
  }

  async function restart() {
    const genesisAction = createUnsignedGenesisAction(identity.pubkey)
    const genesisActionPublished = await publishEvent(genesisAction, DEBUG_RELAY) // FIXME we would normally pass in `relays` here
    console.warn('Restarting Action Chain with Genesis Action:', genesisActionPublished)
  }

  function speedStats() {

    try {
      const velo = parseInt(actions[actions.length-1].tags.find(getTag('velocity'))?.slice(3)) // velocity
      const speed = velo * 60
      const sector = 2**50
      const sectorSec = sector / speed
      const sectorMin = sectorSec / 60
      const sectorHour = sectorMin / 60
      const sectorDay = sectorHour / 24
      const sectorYear = sectorDay / 365
      return [speed, sectorMin, sectorHour, sectorDay, sectorYear]
    } catch (e) {
      return [0, 0, 0, 0, 0]
    }
  
  }

  const [speed, sectorMin, sectorHour, sectorDay, sectorYear] = speedStats()

  const avgTime = actions.reduce((acc, action, actionIndex, allActions) => acc + action.created_at - (actionIndex == 0 ? action.created_at : allActions[actionIndex-1].created_at), 0) / (actions.length - 1)

  return (
    <div id="telemetry-dashboard" className="dashboard">
      <div className="panel" id="chain">
        <h1 style={{position: 'absolute', top: '0', right: '0', textAlign: 'right', color: '#333', margin: '1rem'}}>Cyberspace State Reconciler Telemetry</h1>
        <h1>Action Chain States</h1>
        <p>Each change in the action chain can be stepped through in the order they are received from useCyberspaceStateReconciler. Note that the events are typically received newest-first, so your genesis action will be missing initially if your chain is of any length.</p>
        <p>To start an action chain, click "Begin Action Chain" or "Restart Chain"</p>
        <p>To build on the chain, click "Jump to End" and then "Drift".</p>
        <div className="controls">
          <button disabled={stateIndex <= 0} className="" onClick={() => changeIndex(0)}>Jump to Start</button>
          <button disabled={stateIndex <= 0} onClick={() => changeIndex(stateIndex - 1)}>Previous</button>
          &nbsp; {stateIndex + 1} / {stateLength}
          &nbsp; <button disabled={stateIndex + 1 >= stateLength} onClick={() => changeIndex(stateIndex + 1)}>Next</button>
          <button disabled={stateIndex + 1 >= stateLength} className="button-glow" onClick={() => changeIndex(stateLength-1)}>Jump to End</button>
        </div>
        <p>
          <span><input type="checkbox" checked={autoNext} onChange={() => setAutoNext(!autoNext)} /> Auto-Next</span>
        </p>
        <p>Speed: <strong style={{backgroundColor: '#000', padding: '5px'}}>{speed.toLocaleString('en-US')} Gibsons/sec</strong><br/>
        Minutes per Sector: {sectorMin.toLocaleString('en-US')}<br/>
        Hours per Sector: {sectorHour.toLocaleString('en-US')}<br/>
        Days per Sector: {sectorDay.toFixed(2)}<br/>
        Years per Sector: {sectorYear.toFixed(2)}<br/>
        Years to travel the full length of cyberspace: {(sectorYear * (2**35)).toLocaleString('en-US')}</p>
        <p>Average Time per Action: {avgTime.toFixed(2)}s</p>
        <TimestampLive/>
        <div id="chain-events">
          {debugActions()}
        </div>
      </div>
      <div className="panel" id="actions" style={{ "display": "flex" }}>
        <h1>Controls</h1>
        { actionChainState.status === "valid" && stateIndex === stateLength - 1 ? 
        <>
          <button onClick={move}>Drift</button>
        </>
        :
        <>
          <div>Engine not ready. { stateIndex + 1 < stateLength ? <button className="button-glow" onClick={() => changeIndex(stateLength-1)}>Jump to End</button> : null }</div> 
          <p>actionChainState: {actionChainState.status}</p>
        <button onClick={restart}>Begin Action Chain</button>
        </> }
        <br/>
        <h5>Quaternion</h5>
        <p>Drag to change movement angle.</p>
        <DraggableCube quaternion={quaternion} setQuaternion={setQuaternion}/>
        <button onClick={restart}>Restart Chain</button>
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
  return `#${id.substring(id.length-6)}`
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