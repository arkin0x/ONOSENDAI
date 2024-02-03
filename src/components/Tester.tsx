import { useContext, useEffect, useRef } from 'react'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion } from 'three'
import { createUnsignedGenesisAction } from '../libraries/Cyberspace'
import { publishEvent } from '../libraries/Nostr'

// DEBUG RELAY ONLY
const DEBUG_RELAY = { 'wss://cyberspace.nostr1.com': { read: true, write: true } }

// LEFTOFF - treat tester as our new avatar class and build it up from the ground up. There is a memory leak in Avatar. see if we can utilize the engine to do the same thing as the avatar class but without modifying the display/camera.
export const Tester = () => {
  const { actions, position, velocity, rotation, simulationHeight, actionChainState } = useCyberspaceStateReconciler()

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
    return actions.map((action, index) => {
      return (
        <div key={index} style={{ margin: "1rem", wordWrap: "break-word" }}>
          {action.created_at}<br />
          {action.id}<br />
          {JSON.stringify(action.tags).replace(',', '\n')}
        </div>
      );
    });
  }

  function move() {
    // const { created_at, ms_timestamp, ms_only, ms_padded } = getTime()
    // console.log('MOVE', created_at, ms_timestamp, ms_only, ms_padded)
    drift(5, new Quaternion(0, 0, 0, 1));
  }

  async function restart() {
    const genesisAction = createUnsignedGenesisAction(identity.pubkey);
    const genesisActionPublished = await publishEvent(genesisAction, DEBUG_RELAY); // FIXME we would normally pass in `relays` here
    console.warn('Restarting Action Chain with Genesis Action:', genesisActionPublished);
  }

  return (
    <div id="tester" style={{ "color": "#777" }}>
      <div id="debug">
        {debugActions()}
      </div>
      <div id="actions" style={{ "display": "flex" }}>
        <button onClick={move}>Move</button>
        <button onClick={restart}>Restart</button>
      </div>
      <div id="test_calculations">
        <pre>
          &nbsp;
        </pre>
      </div>
    </div>
  );
};
