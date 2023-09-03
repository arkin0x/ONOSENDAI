import { useEffect, useReducer, useContext } from 'react'
import { IdentityContextType } from '../src/types/IdentityType'
import { IdentityContext } from '../src/providers/IdentityProvider'
import { ModalContextType } from '../src/types/ModalType'
import { ModalContext } from '../src/providers/ModalProvider'
import { Filter } from 'nostr-tools'
import { getRelayList, pool } from "../src/libraries/Nostr"
import { useGeolocationData } from "../src/hooks/useGeolocationData"
import { useMap } from 'react-map-gl'
import { Marker } from 'react-map-gl'
import '../scss//MapPlaces.scss'
import { DraftPlaceContext } from '../src/providers/DraftPlaceProvider'
import { DraftPlaceContextType, EventWithoutContent, Place, PlaceProperties } from '../src/types/Place'
import { RelayList } from '../src/types/NostrRelay'
import { getTag } from "../src/libraries/Nostr"
import { Beacon } from './Beacon'

// type MapPlacesProps = {
//   children?: React.ReactNode
// }

type beaconsReducerType = {
  [key: string]: Place
}

const getUniqueBeaconID = (beacon: Place) => {
  const dtag = beacon.tags.find(getTag("d"))
  const dtagValue = dtag?.[1]
  const pubkey = beacon.pubkey
  const kind = beacon.kind
  return `${dtagValue}-${pubkey}-${kind}`
}

const beaconsReducer = (state: beaconsReducerType, action: { type: string; beacon: Place }) => {
  const unique = getUniqueBeaconID(action.beacon)
  const existing = state[unique]
  // only save the newest beacon by created_at timestamp; if this incoming beacon s older, don't save it.
  if (existing && existing.created_at > action.beacon.created_at) return state

  // proceed with save
  switch(action.type) {
    case 'add': 
      return {
        ...state,
        [unique]: action.beacon  
      }
    default:
      return state
  }
}

type beaconsStateReducerType = string[]

const beaconsStateReducer = (state: beaconsStateReducerType, action: { type: string; beacon: Place }) => {
  // when a beacon is toggled open, put its unique ID at the front of the state array; the first beacon is rendered on top.
  // when a beacon is toggled closed, remove its unique ID from the state array.
  const unique = getUniqueBeaconID(action.beacon)
  switch(action.type) {
    case 'add': 
      return [
        unique,
        ...state.filter( (id) => id !== unique )
      ]
    case 'remove':
      return [
        ...state.filter( (id) => id !== unique )
      ]
    default:
      return state
  }
}

export const MapPlaces = () => {
  const [beacons, beaconsDispatch] = useReducer(beaconsReducer, {})
  const [beaconsToggleState, setBeaconsToggleState] = useReducer(beaconsStateReducer, [])
  const {position} = useGeolocationData()
  const {current: map} = useMap()
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const {modal} = useContext<ModalContextType>(ModalContext)
  const {draftPlace, setDraftPlace} = useContext<DraftPlaceContextType>(DraftPlaceContext)

  useEffect( () => {
    const filter: Filter<37515> = {kinds: [37515]}
    const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(relayList, [filter])
    // get places from your relays
    sub.on('event', (event) => {
      let placeProperties: PlaceProperties
      try {
        placeProperties = JSON.parse(event.content)
        if (!placeProperties.geometry || !placeProperties.geometry.coordinates) throw new Error('No coordinates')
        // if any events have malformed coordinates using an object with lat or lng properties, convert them to array/mapbox format
        if (!Array.isArray(placeProperties.geometry.coordinates)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const {lng, lat} = placeProperties.geometry.coordinates as any
          const lngLatArray: [number, number] = [lng, lat]
          placeProperties.geometry.coordinates = lngLatArray
        }
        const foundEvent: EventWithoutContent = {
          ... event
        }
        const place: Place = {
          ... foundEvent,
          content: placeProperties as PlaceProperties
        }

        beaconsDispatch({
          type: 'add',
          beacon: place 
        })
      } catch (e) {
        // console.log('Failed to parse event content:', e)
      }
    })
    return () => {
      sub.unsub()
    }
  }, [relays])

  const beaconsArray = Object.values(beacons)

  beaconsArray
    // Sort first by the first elements in beaconToggleState, then by oldest to newest.
    .sort( (a, b) => {
      const aIndex = beaconsToggleState.indexOf(getUniqueBeaconID(a))
      const bIndex = beaconsToggleState.indexOf(getUniqueBeaconID(b))
      if (aIndex === -1 && bIndex === -1) {
        // neither is in the toggle state, sort by newest to oldest
        return b.created_at - a.created_at
      } else if (aIndex === -1) {
        // a is not in the toggle state, sort it below b
        return 1
      } else if (bIndex === -1) {
        // b is not in the toggle state, sort it below a
        return -1
      } else {
        // both are in the toggle state, sort by their index in the toggle state
        return aIndex - bIndex
      }
    }).reverse()

  console.log(beaconsArray.map( b => getUniqueBeaconID(b).split('-')[0]))

  // iterate through beacon data and prepare it for map display. 
  return beaconsArray 
    // convert each beacon into a JSX Beacon Component
    .map( (beacon: Place ) => {
      // move map so the beacon is left of the details box
      const handleFollow = () => {
        if (map && position) {
          map.flyTo({
            center: [beacon.content.geometry.coordinates[0] + 0.0015, beacon.content.geometry.coordinates[1]],
            zoom: 16,
            duration: 1000,
          })
        }
      }
      // move map so the beacon is above the edit form
      const handleEdit = () => {
        if (map && position) {
          map.flyTo({
            center: [beacon.content.geometry.coordinates[0], beacon.content.geometry.coordinates[1] - 0.0015],
            zoom: 16,
            duration: 1000,
          })
        }
      }
      return (
        <Marker clickTolerance={5} key={beacon.id} longitude={beacon.content.geometry.coordinates[0]} latitude={beacon.content.geometry.coordinates[1]} offset={[-20,-52]} anchor={'center'}>
          <Beacon
            currentUserPubkey={identity?.pubkey}
            relays={relays}
            modal={modal}
            beaconData={beacon}
            toggleHandler={setBeaconsToggleState}
            clickHandler={handleFollow}
            editHandler={handleEdit}
            draft={{
              draftPlace,
              setDraftPlace
            }} 
            />
        </Marker>
      )
    })
}
