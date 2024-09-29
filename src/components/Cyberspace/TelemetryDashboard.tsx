import type { Event } from 'nostr-tools'
import { useState } from 'react'
import '../../scss/Telemetry.scss'
import { isGenesisAction } from '../../libraries/Cyberspace'
import { countLeadingZeroesHex } from '../../libraries/Hash'
import { useAvatarStore } from '../../store/AvatarStore'
import { DebugLocal } from '../DebugLocal'
import useNDKStore from '../../store/NDKStore'

// this dashboard is to visualize the nostr action chain.
export const TelemetryDashboard = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity!.pubkey
  const {actionState} = useAvatarStore()

  const actions = actionState[pubkey]

  const [selectedAction, setSelectedAction] = useState<Event | null>(null)


  const renderActions = () => {
    if (!actions) return null
    return actions.map((action) => {
      return <ActionDOM key={action.id} action={action} select={setSelectedAction}/>
    }).reverse()
  }

  return (
    <div id="telemetry-dashboard" className="dashboard">
      <br/>
      <br/>
      <br/>
      <br/>
      <h1>Telemetry Dashboard</h1>
      <div id="actions">
        {selectedAction 
          ? <div className="selected-action">
              <button className="close" onClick={() => setSelectedAction(null)}>Close</button>
              <h2>Selected Action</h2>
             <span className="pow">{ countLeadingZeroesHex(selectedAction.id) } POW</span>
              <div className="action-details">
                <h3>Details</h3>
                <pre>{JSON.stringify(selectedAction, null, 2)}</pre>
              </div>
            </div> 
          : renderActions()
        }
      </div>
      <div id="debug">
          {/* <DebugLocal/> */}
      </div>
    </div>
  )
}

type ActionDOMProps = {
  action: Event 
  select: (action: Event) => void
}
const ActionDOM = ({action, select}: ActionDOMProps) => {

  const borderColor = "#" + action.id.substring(action.id.length-6, action.id.length)
  const isGenesis = isGenesisAction(action)

  return (
    <div className="action">
      <div className={"block"} style={{borderColor}} onClick={() => select(action)}>
        <span className="pow">{countLeadingZeroesHex(action.id)}</span>
      </div>
      {isGenesis ? <label className="genesis">GENESIS</label> : null}
      {action.sig ? <label className="sig">🔏</label> : null}
    </div>
  )
}

