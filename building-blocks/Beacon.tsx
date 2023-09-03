import { useState, useEffect } from 'react'
import { ModalType } from '../src/types/ModalType'
import { Filter } from 'nostr-tools'
import { getRelayList, pool } from "../src/libraries/Nostr"
import { useGeolocationData } from "../src/hooks/useGeolocationData"
import { isOpenNow } from '../src/libraries/decodeDay'
import { DraftPlaceContextType, Place } from '../src/types/Place'
import { beaconToDraftPlace } from '../src/libraries/draftPlace'
import { CursorPositionType } from '../src/providers/GeolocationProvider'
import { RelayList, RelayObject } from '../src/types/NostrRelay'
import { MapPin } from './MapPin'

type BeaconProps = {
  currentUserPubkey: string | undefined
  relays: RelayObject
  beaconData: Place
  modal: ModalType
  toggleHandler: React.Dispatch<{
    type: string;
    beacon: Place;
  }>
  clickHandler: () => void
  editHandler: () => void
  draft: DraftPlaceContextType
}
export const Beacon = ({ currentUserPubkey, relays, beaconData, modal, toggleHandler, clickHandler, editHandler, draft }: BeaconProps) => {
  const [show, setShow] = useState<boolean>(false)
  const [beaconProfilePicture, setBeaconProfilePicture] = useState<string>('')
  const { setDraftPlace } = draft
  const { setCursorPosition } = useGeolocationData()
  const relayList: RelayList = getRelayList(relays, ['read'])

  useEffect(() => {
    // get profile for beacon owner (pubkey) by querying for most recent kind 0 (profile)
    const filter: Filter = { kinds: [0], authors: [beaconData.pubkey] }
    const profileSub = pool.sub(relayList, [filter])
    profileSub.on('event', (event) => {
      // this will return the most recent profile event for the beacon owner; only the most recent is stored as specified in NIP-01
      try {
        const profile = JSON.parse(event.content)
        setBeaconProfilePicture(profile.picture)
      } catch (e) {
        console.log('Failed to parse event content:', e)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = () => {
    if (!modal?.placeForm) {
      if (!show) {
        // we are opening the beacon details
        clickHandler()
        setCursorPosition(null)
        toggleHandler({
          type: 'add',
          beacon: beaconData
        })
      } else {
        // we are closing the beacon details
        toggleHandler({
          type: 'remove',
          beacon: beaconData
        })
      }
      // do toggle
      setShow(!show)
    }
  }

  const editPlace = () => {
    editHandler()
    // set cursor to beacon's current coordinates
    const lnglat: CursorPositionType = {
      lng: beaconData.content.geometry.coordinates[0],
      lat: beaconData.content.geometry.coordinates[1]
    }
    setCursorPosition(lnglat)
    // load place data into modal 
    const newPlace = beaconToDraftPlace(beaconData, relayList)
    // set draft place
    setDraftPlace(newPlace)
    modal?.setPlaceForm('edit')
  }

  const mapMarker = <div className="beacon__marker" onClick={toggle}>{<MapPin color={`#${beaconData.pubkey.substring(0, 6)}`} image={beaconProfilePicture} />}</div>

  const showBeaconInfo = () => {

    let beaconName = null
    try {
      beaconName = <h2>{beaconData.content.properties.name}</h2>
    } catch (e) {
      console.log('failed to parse name', e)
    }

    let beaconDescription = null
    try {
      beaconDescription = <p>{beaconData.content.properties.description}</p>
    } catch (e) {
      console.log('failed to parse description', e)
    }

    let hours = null
    try {
      hours = <p className="hours">{
        beaconData.content.properties.hours
        ? 
          isOpenNow(beaconData.content.properties.hours)
          ? 
            <>
              "🟢 Open Now" : "⛔ Not Open Right Now"
              <br />
              <small>{beaconData.content.properties.hours}</small>
            </>
          : null
        : null
      }</p>
    } catch (e) {
      // console.log('failed to parse hours', e)
    }

    let edit = null
    try {
      if (currentUserPubkey === beaconData.pubkey)
        edit = <button onClick={editPlace} style={{ float: "right", marginTop: "1.5rem", marginRight: "-1.0rem" }}>Edit</button>
    } catch (e) {
      console.log('', e)
    }

    return (
      <div className="beacon__info" onClick={toggle}>
        {beaconName}
        {beaconDescription}
        {hours}
        {edit}
      </div>
    )
  }

  const beaconClasses = `beacon ${show ? 'beacon--show' : ''}`

  return (
    <div className={beaconClasses}>
      {mapMarker}
      {show ? showBeaconInfo() : null}
    </div>
  )
}
