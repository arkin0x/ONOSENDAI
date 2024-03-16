import { useContext, useEffect, useState } from 'react'
import { IdentityContextType } from '../types/IdentityType'
import { IdentityContext } from '../providers/IdentityProvider'
import { DecimalVector3 } from '../libraries/DecimalVector3'
import { getSectorFromCoordinate } from '../libraries/Cyberspace'
import { NDKContext } from '../providers/NDKProvider'
import { AvatarContext } from '../providers/AvatarContext'
import { Event } from 'nostr-tools'
import { CyberspaceKinds, CyberspaceNDKKinds } from '../types/CyberspaceNDK'
import { NDKSubscription } from '@nostr-dev-kit/ndk'

export const SectorManager = () => {
  const ndk = useContext(NDKContext)
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const {state} = useContext(AvatarContext)
  const [currentSector, setCurrentSector] = useState<DecimalVector3>()

  // get the latest user state and update the current sector
  // FIXME: this should actually be based on latest simulated state, not the latest action state, but oh well.
  useEffect(() => {
    if (!ndk || !identity) return

    const latestUserState = state[identity.pubkey].slice(-1)[0] as Event
    if (!latestUserState) return // no actions received yet

    try {
      const coordinate = latestUserState.tags.find(tag => tag[0] === 'C')?.[1]
      if (!coordinate) throw new Error('No coordinate tag found')

      const sector = getSectorFromCoordinate(coordinate)
      setCurrentSector(sector)

    } catch (e) {
      console.error('Error getting coordinate tag', e)
    }

  }, [ndk, identity.pubkey, state[identity.pubkey]])

  // when the current sector changes, update the sectors we are getting data for
  useEffect(() => {
    if (!ndk || !identity || !currentSector) return

    const subscriptions: NDKSubscription[] = []

    // subscribe to the sectors in a cube around the curret sector, including the current sector

    for (let x = -1; x < 2; x++) {
      for (let y = -1; y < 2; y++) {
        for (let z = -1; z < 2; z++) {
          const copyCurrentSector = new DecimalVector3(currentSector.x.add(x), currentSector.y.add(y), currentSector.z.add(z))
          const filter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds, CyberspaceKinds.Construct as CyberspaceNDKKinds], '#S': [ ...copyCurrentSector.toArray().join('-')]}
          console.log('filter', filter, filter['#S'])
          const sub = ndk.subscribe(filter, {closeOnEose: false})
          subscriptions.push(sub)
        }
      }
    }

    // setup listeners for subscriptions
    const handleEvent = (event: Event) => {
      if (event.kind === CyberspaceKinds.Action) {
        // TODO
        // LEFTOFF: we need a sector state provider + reducer to store objects found in sectors and address them by sector.
      } else if( event.kind === CyberspaceKinds.Construct) {
        // TODO
      }
    }

    subscriptions.forEach(sub => sub.on('event', handleEvent))

    return () => {
      // cleanup sector subscriptions
      subscriptions.forEach(sub => sub.stop())
    }
  }, [currentSector])

  if (!currentSector) return null

  return <Sector id={currentSector?.toArray().join('-')} />// TODO: return sectors here
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