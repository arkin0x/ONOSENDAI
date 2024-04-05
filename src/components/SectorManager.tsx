import { useContext, useEffect, useReducer, useState } from 'react'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { getSectorFromCoordinate, getSectorId } from '../libraries/Cyberspace'
import { NDKContext } from '../providers/NDKProvider'
import { AvatarContext } from '../providers/AvatarContext'
import { Event } from 'nostr-tools'
import { CyberspaceKinds, CyberspaceNDKKinds } from '../types/CyberspaceNDK'
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk'

type SectorState = {
  [sectorid: string]: {
    avatars: Set<string>, // pubkeys
    constructs: Set<string>, // event ids
  }
}

const initialSectorState: SectorState = {}

type SectorAction = 
  | {type: 'dump'; sectorId: string} // remove a sector from state and all of its objects
  | {type: 'mount'; sectorId: string} // add a sector to state and begin processing its objects
  | {type: 'addAvatar'; sectorId: string; pubkey: string} // add an avatar's pubkey
  | {type: 'removeAvatar'; sectorId: string; pubkey: string} // remove an avatar's pubkey. This would happen if the simulated or current state of an avatar went outside of our sector radius.
  | {type: 'addConstruct'; sectorId: string; eventId: string} // add a construct. (We don't need to remove them.)

const sectorReducer = (state: SectorState, action: SectorAction): SectorState => {
  const newState = {...state}

  if (action.type === 'dump') {
    delete newState[action.sectorId]
  }
  if (action.type === 'mount') {
    newState[action.sectorId] = {avatars: new Set(), constructs: new Set()}
  }
  if (action.type === 'addAvatar') {
    newState[action.sectorId].avatars.add(action.pubkey)
  }
  if (action.type === 'removeAvatar') { // this would happen if the simulated or current state of an avatar went outside of our sector radius.
    newState[action.sectorId].avatars.delete(action.pubkey)
  }
  if (action.type === 'addConstruct') {
    newState[action.sectorId].constructs.add(action.eventId)
  }

  return newState
}

/**
 * The adjacent <Avatar> in <CyberspaceViewer> will initialize the user's pubkey into the AvatarContext.
 * SectorManager will use the user's latest simulated action in the AvatarContext to determine the current sector. It will then subscribe to the sectors in a cube around the current sector, including the current sector. It will then render the objects in the sectors.
 * When the sector changes, the subscriptions will be updated and SectorManager will update the objects we are rendering.
 */
export const SectorManager = ({radius}: {radius?: number}) => {
  const ndk = useContext(NDKContext)
  const {identity} = useContext<IdentityContextType>(IdentityContext)
  const {actionState, simulatedState} = useContext(AvatarContext)
  const [currentSector, setCurrentSector] = useState<DecimalVector3>()
  const [sector, dispatchSector] = useReducer(sectorReducer, initialSectorState)

  const pubkey = identity?.pubkey
  if (!pubkey) console.warn('Sector Manager: No pubkey found in identity context')

  /**
   * Functions
   */

  /**
   * Subscribes to the sectors in a cube around the current sector, including the current sector.
   */
  const subscribeToSector = (ndk: NDK, sectorCoord: DecimalVector3) => {
    const filter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds], '#S': [ getSectorId(sectorCoord) ]}
    console.log('filter', filter, filter['#S'])
    const sub = ndk.subscribe(filter, {closeOnEose: false})
    return sub
  }

  /**
   * Get the current sector from the user's latest simulated state.
   */
  useEffect(() => {
    if (!ndk || !identity || !simulatedState[pubkey] || actionState[pubkey] ) return

    let presence = simulatedState[pubkey]

    try {

      if (!presence) {
        // if (actionState[pubkey]) // if we don't have any actions yet, we can't determine the sector. Wait for this useEffect to run again.
        presence = actionState[pubkey].slice(-1)[0] as Event
      }

      console.log('presence update!', presence)

      const coordinate = presence.tags.find(tag => tag[0] === 'C')?.[1]

      if (!coordinate) {
        console.warn('Sector Manager: No coordinate tag found on presence event')
        throw new Error('No coordinate tag found on presence event')
      }

      const sector = getSectorFromCoordinate(coordinate)
      setCurrentSector(sector)

    } catch (e) {
      console.warn('Sector Manager: Error getting coordinate tag', e, presence, actionState[pubkey])
    }

  }, [ndk, pubkey, actionState, simulatedState])

  /**
   * When the current sector changes, mount the sector in the state.
   */
  useEffect(() => {
    if (!currentSector) return

    dispatchSector({type: 'mount', sectorId: getSectorId(currentSector)})

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSector])

  // when the current sector changes, update the sectors we are getting data for
  useEffect(() => {
    if (!ndk || !identity || !currentSector) return

    const newSectorSet = new Set<string>()
    const subscriptions: NDKSubscription[] = []

    // subscribe to the sectors in a cube radius around the curret sector, including the current sector
    const rT = Math.abs(radius || 0) // radius top (positive)
    const rB = -rT // radius bottom (negative)
    for (let x = rB; x <= rT; x++) {
      for (let y = rB; y <= rT; y++) {
        for (let z = rB; z <= rT; z++) {
          const sectorCopy = new DecimalVector3(currentSector.x.add(x), currentSector.y.add(y), currentSector.z.add(z))
          // add new sectors to set for comparing to old sectors
          newSectorSet.add(getSectorId(sectorCopy))
          // subscribe to new sectors
          subscriptions.push(subscribeToSector(ndk, sectorCopy))
        }
      }
    }

    // delete old sectors that are not in the new set
    const oldSectorSet = new Set<string>(Object.keys(sector))
    oldSectorSet.forEach(sectorId => {
      if (!newSectorSet.has(sectorId)) {
        dispatchSector({type: 'dump', sectorId})
      }
    })

    // setup listeners for subscriptions
    const handleEvent = (event: Event) => {
      if (event.kind === CyberspaceKinds.Action) {
        dispatchSector({type: 'addAvatar', sectorId: getSectorId(currentSector), pubkey: event.pubkey})
      } else if( event.kind === CyberspaceKinds.Construct) {
        // TODO
        dispatchSector({type: 'addConstruct', sectorId: getSectorId(currentSector), eventId: event.id})
      }
    }
    subscriptions.forEach(sub => sub.on('event', handleEvent))

    return () => {
      // cleanup sector subscriptions (will happen when useEffect dependencies change or on unmount.)
      subscriptions.forEach(sub => sub.stop())
    }
  }, [ndk, identity, currentSector, radius])

  if (!currentSector) return null

  // LEFTOFF
  // TODO: render sectors here. Each sector should initialize an <Avatar> and <Construct> for each object in that sector.
  return <Sector id={getSectorId(currentSector)} />
}

type SectorProps = {
  id: string
}

/**
 * Renders the objects within a sector (normally the current sector, but adjacent could be rendered as a buffer)
 * @returns React.Fragment<Avatar|Construct|...>
 */
export const Sector = ({id: string}: SectorProps) => {
  // get the objects in the sector from the context via sector ID
  // render them

  console.log('rendering sector of id', string)
  return null
}