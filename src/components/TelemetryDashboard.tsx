import { useContext, useEffect, useRef } from 'react'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion } from 'three'
import { createUnsignedGenesisAction } from '../libraries/Cyberspace'
import { publishEvent } from '../libraries/Nostr'
import { Event } from 'nostr-tools'
import { useTelemetry } from '../hooks/cyberspace/useTelemetry'

// DEBUG RELAY ONLY
const DEBUG_RELAY = { 'wss://cyberspace.nostr1.com': { read: true, write: true } }

// this dashboard is to visualize the nostr action chain.
export const TelemetryDashboard = () => {
  const { telemetryState, stateIndex, changeIndex } = useTelemetry()

  const { actions, position, velocity, rotation, simulationHeight, actionChainState } = telemetryState

  const { identity } = useContext(IdentityContext)

  const { drift, stopDrift, setGenesisAction, setLatestAction } = useEngine(identity.pubkey, DEBUG_RELAY)

  const engineReadyRef = useRef(false)

  useEffect(() => {
    if (actionChainState.status === 'valid') {
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      engineReadyRef.current = true
    }
  }, [actions, position, velocity, rotation, simulationHeight, actionChainState, setGenesisAction, setLatestAction])

  function debugActions() {
    return actions.map((action) => {
      return <ActionDOM key={action.id} action={action} />
    });
  }

  function move() {
    // const { created_at, ms_timestamp, ms_only, ms_padded } = getTime()
    // console.log('MOVE', created_at, ms_timestamp, ms_only, ms_padded)
    drift(5, new Quaternion(0, 0, 0, 1))
  }

  async function restart() {
    const genesisAction = createUnsignedGenesisAction(identity.pubkey);
    const genesisActionPublished = await publishEvent(genesisAction, DEBUG_RELAY); // FIXME we would normally pass in `relays` here
    console.warn('Restarting Action Chain with Genesis Action:', genesisActionPublished);
  }

  return (
    <div id="telemetry-dashboard" className="dashboard">
      <div className="panel" id="chain">
        <h1>Action Chain</h1>
        <div className="controls">
          <button onClick={() => changeIndex(stateIndex - 1)}>Previous</button>
          <button onClick={() => changeIndex(stateIndex + 1)}>Next</button>
        </div>
        {debugActions()}
      </div>
      <div className="panel" id="actions" style={{ "display": "flex" }}>
        <button onClick={move}>Move</button>
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

const ActionDOM = ({action}: {action: Event}) => {
  const tags = action.tags.map((tag) => {
    return <span key={tag[0]} className="tag"><span className="highlight">{tag[0]}:</span> {tag.slice(1).join(', ')}</span>
  })
  return (
    <div key={action.id} className="event-action" style={{ margin: "1rem", wordWrap: "break-word" }}>
      <span className="heavy">
        {action.created_at}<br />
      </span>
      <span className="highlight">
        {action.id}
      </span>
      {tags}
    </div>
  );
}