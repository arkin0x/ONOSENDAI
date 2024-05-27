import type { Event } from 'nostr-tools'
import { useContext, useState } from 'react'
import '../scss/Telemetry.scss'
import { AvatarContext } from '../providers/AvatarContext'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { isGenesisAction } from '../libraries/Cyberspace'
import { NDKEvent } from '@nostr-dev-kit/ndk'

// this dashboard is to visualize the nostr action chain.
export const TelemetryDashboard = () => {

  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const pubkey = identity.pubkey
  const {actionState, simulatedState} = useContext(AvatarContext)

  const actions = actionState[pubkey]
  const nextAction = simulatedState[pubkey]

  return (
    <div id="telemetry-dashboard" className="dashboard">
      <h1>Telemetry Dashboard</h1>
      <div id="actions">
        {actions.map((action) => {
          return <ActionDOM key={action.id} action={action}/>
        })}
        {/* {nextAction ? <ActionDOM key={nextAction.id} action={nextAction} /> : null} */}
      </div>
    </div>
  )
}

type ActionDOMProps = {
  action: Event 
}
const ActionDOM = ({action}: ActionDOMProps) => {

  const [expanded, setExpanded] = useState(false)

  const borderColor = "#" + action.id.substring(action.id.length-6, action.id.length)
  const isGenesis = isGenesisAction(action)

  return (
    <div className="action">
      <div className="block" style={{borderColor}} onClick={() => setExpanded(!expanded)}>
        { expanded ? 
          <pre>{JSON.stringify(action)}</pre>
        : <span className="data">{action.id}</span>
      }
      </div>
      {isGenesis ? <label className="genesis">GENESIS</label> : null}
    </div>
  )
}
