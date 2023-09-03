import React, { useContext, useState, useEffect, useRef } from "react"
import { useGeolocationData } from "../hooks/useGeolocationData"
import {
  typeDropdown,
  DraftPlace,
  requiredProperties,
  SignableDraftPlace,
  GooglePlaceType,
  GooglePlaceStatus,
  AddressKeys,
} from "../types/Place"
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { ModalContextType } from "../types/ModalType"
import { ModalContext } from "../providers/ModalProvider"
import { DraftPlaceContext } from "../providers/DraftPlaceProvider"
import { DraftPlaceContextType } from "../types/Place"
import { freshDefaultPlace } from "../libraries/defaultPlace"
import { FancyButton } from "../../building-blocks/FancyButton"
import "../scss/PlaceForm.scss"
import { getRelayList, pool } from "../libraries/Nostr"
import Geohash from "latlon-geohash"
import { signEvent } from "../libraries/NIP-07"
import { createDraftPlace, createNaddr } from "../libraries/draftPlace"
import { Event, getEventHash, getSignature } from "nostr-tools"
import { decryptPrivateKey } from "../libraries/EncryptAndStoreLocal"
/* create a tsx form to handle input for a new place based on the examplePlace: 
const examplePlace = `
{
  "kind": 37515,
  "tags": [
    [ "d", "North Dakota Heritage Center & State Museum" ],
    [ "g", "cb266epj" ],
    [ "alt", "This event represents a place. View it on go.yondar.me/${exampleNaddr}" ]
  ],
  "content": {
    "type": "Feature",
    "properties": {
      "name": "North Dakota Heritage Center & State Museum",
      "abbrev": "Heritage Center",
      "description": "State history museum offering exhibits on the state's geologic prehistory, early peoples & culture.",
      "address": {
        "street-address": "612 E Boulevard Ave",
        "locality": "Bismarck",
        "region": "North Dakota",
        "country-name": "United States",
        "postal-code": "58505"
      },
      "type": "museum",
      "status": "OPERATIONAL",
      "website": "https://statemuseum.nd.gov/",
      "phone": "+1-701-328-2666",
      "hours": "Mo-Fr 08:00-17:00; Sa-Su 10:00-17:00"
    },
    "geometry": {
      "coordinates": [
        -100.77873491903246,
        46.81915362955226
      ],
      "type": "Point"
    }
  }
}`
*/

type PlaceFormProps = {
  edit: boolean // the modal may be set to false to hide, true to show, or 'edit' to show and allow editing. But edit can only be true or false, and is only true when modal is set to 'edit'.
}
export const PlaceForm: React.FC<PlaceFormProps> = ({ edit = false }) => {
  const { identity, relays } = useContext<IdentityContextType>(IdentityContext)
  const { draftPlace, setDraftPlace } = useContext<DraftPlaceContextType>(DraftPlaceContext)
  const { cursorPosition, setCursorPosition } = useGeolocationData()
  const { modal } = useContext<ModalContextType>(ModalContext)

  // state for name field value so we can get an updated naddr
  const [naddr, setNaddr] = useState<string>("")
  // state to refresh form on reset
  const [formKey, setFormKey] = useState<number>(0)

  // refs for all fields
  const nameRef = useRef<HTMLInputElement>(null)
  const abbrevRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const streetAddressRef = useRef<HTMLInputElement>(null)
  const localityRef = useRef<HTMLInputElement>(null)
  const regionRef = useRef<HTMLInputElement>(null)
  const countryNameRef = useRef<HTMLInputElement>(null)
  const postalCodeRef = useRef<HTMLInputElement>(null)
  const typeRef = useRef<HTMLSelectElement>(null)
  const statusRef = useRef<HTMLSelectElement>(null)
  const websiteRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  // get naddr
  const relayList = getRelayList(relays, ['write'])
  useEffect(() => {
    const naddr = createNaddr(
      identity.pubkey,
      nameRef.current?.value || "",
      relayList
    )
    setNaddr(naddr)
  }, [identity.pubkey, draftPlace, relayList])

  // get geohash from coordinates from latlong-geohash library
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const geohash = Geohash.encode(cursorPosition!.lat, cursorPosition!.lng, 5)

  const prepareFormData = (): DraftPlace => {
    return createDraftPlace(
      nameRef.current?.value || "",
      geohash,
      naddr,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      descriptionRef.current?.value || "",
      typeRef.current?.value as GooglePlaceType || "point_of_interest" as GooglePlaceType, 
      [cursorPosition!.lng, cursorPosition!.lat],
      abbrevRef.current?.value || "",
      streetAddressRef.current?.value || "",
      localityRef.current?.value || "",
      regionRef.current?.value || "",
      countryNameRef.current?.value || "",
      postalCodeRef.current?.value || "",
      statusRef.current?.value as GooglePlaceStatus || "OPERATIONAL" as GooglePlaceStatus,
      websiteRef.current?.value || "",
      phoneRef.current?.value || ""
    )
  }

  const updateDraft = () => {
    const newPlace = prepareFormData()
    setDraftPlace(newPlace)
  }

  const resetForm = () => {
    setDraftPlace(freshDefaultPlace())
    setFormKey(formKey + 1)
  }
  const cancelEdit = () => {
    resetForm()
    setCursorPosition(null)
    modal?.setPlaceForm(false)
  }


  const publish = async () => {
    // create an event from the form data conforming to the type DraftPlace
    if (!nameRef.current?.value) return // name is required
    if (!cursorPosition) return // this should never happen

    const newPlace = prepareFormData()

    // eliminate empty optional fields
    Object.keys(newPlace.content.properties).forEach((key) => {
      if (
        !requiredProperties.includes(key) &&
        newPlace.content.properties[key] === ""
      ) {
        delete newPlace.content.properties[key]
      }
    })
    // eliminate empty fields from address property, and eliminate the address property altogether if it is totally full of empty fields:
    if (newPlace.content.properties.address !== undefined) {
      Object.keys(newPlace.content.properties.address).forEach((key) => {
        if (newPlace.content.properties.address !== undefined) {
          if (newPlace.content.properties.address[key as AddressKeys] === "" || newPlace.content.properties.address[key as AddressKeys] === undefined) {
            delete newPlace.content.properties.address[key as AddressKeys]
          }
        }
      })
      if (Object.keys(newPlace.content.properties.address).length === 0) {
        delete newPlace.content.properties.address
      }
    }

    // stringify content property
    const signableDraftPlace: SignableDraftPlace = {
      ...newPlace,
      content: JSON.stringify(newPlace.content),
      created_at: Math.floor(Date.now() / 1000),
      pubkey: identity.pubkey,
    }

    // publish the event
    let signedEvent
    if (localStorage.getItem("storens")){
      // sign via nostr-tools
      let sk
      const tryToSign = async () => {
        try {
          sk = await decryptPrivateKey('signing') 
        } catch (e) {
          alert("Wrong password! Could not decrypt local signing key. Please try publishing again.")
        }
      }
      await tryToSign()
      if (!sk) signedEvent = null
      else {
        const eventHash = await getEventHash(signableDraftPlace)
        const eventSig = await getSignature(signableDraftPlace, sk)
        signedEvent = signableDraftPlace as Event<37515>
        signedEvent.id = eventHash
        signedEvent.sig = eventSig
      }
    } else {
      signedEvent = await signEvent(signableDraftPlace)
    }

    if (signedEvent === null) {
      // TODO: notify user
      console.error("Failed to sign event.")
      return
    }

    const relayList = getRelayList(relays, ['write'])
    const pub = pool.publish(relayList, signedEvent)
    pub.on("ok", () => {
      console.log("Event published successfully!")
      // TODO: clear form, show success message, close modal, happy animation, zoom in on new place?
      modal?.setPlaceForm(false)
      resetForm()
      setCursorPosition(null)
    })
    pub.on("failed", (reason: string) => {
      console.error(`Failed to publish event. ${reason}`)
    })
  }

  const editClass = edit ? 'edit' : ''

  return (
    <div id="component-placeform" className={editClass} key={formKey}>
      { edit ? <button style={{float: 'right'}} onClick={cancelEdit}>Cancel Edit</button> : <button style={{float: 'right'}} onClick={resetForm}>Reset Form</button> } 
      <h1>{edit ? "Edit your" : "Add a"} Place 📍</h1>
      {edit ? null : (
        <p>Places can be edited later! They are replaceable events.</p>
      )}
      <label htmlFor="name">Name</label>
      <input
        required={true}
        id="name"
        ref={nameRef}
        defaultValue={draftPlace.content.properties.name || ""}
        type="text"
        placeholder="Name of this Place"
        onChange={() => updateDraft()}
      />
      <label htmlFor="abbrev">Abbreviation</label>
      <input
        id="abbrev"
        ref={abbrevRef}
        defaultValue={draftPlace.content.properties.abbrev || ""}
        type="text"
        placeholder="Abbreviated (short) name"
        onChange={() => updateDraft()}
      />
      <label htmlFor="description">Description</label>
      <textarea
        id="description"
        ref={descriptionRef}
        defaultValue={draftPlace.content.properties.description || ""}
        placeholder="A couple sentences to decribe the Place"
        onChange={() => updateDraft()}
      ></textarea>
      <label htmlFor="address">
        <h2>
          Address Information
          <br />
          <small>(optional)</small>
        </h2>
      </label>
      <fieldset id="address">
        <label htmlFor="street-address">Street Address</label>
        <input
          id="street-address"
          ref={streetAddressRef}
          defaultValue={
            draftPlace.content.properties.address?.["street-address"] || ""
          }
          type="text"
          placeholder="Street Address"
          onChange={() => updateDraft()}
        />
        <label htmlFor="locality">City</label>
        <input
          id="locality"
          ref={localityRef}
          defaultValue={draftPlace.content.properties.address?.locality || ""}
          type="text"
          placeholder="City"
          onChange={() => updateDraft()}
        />
        <label htmlFor="region">State</label>
        <input
          id="region"
          ref={regionRef}
          defaultValue={draftPlace.content.properties.address?.region || ""}
          type="text"
          placeholder="State"
          onChange={() => updateDraft()}
        />
        <label htmlFor="country-name">Country</label>
        <input
          id="country-name"
          ref={countryNameRef}
          defaultValue={draftPlace.content.properties.address?.["country-name"] || ""}
          type="text"
          placeholder="Country"
          onChange={() => updateDraft()}
        />
        <label htmlFor="postal-code">Postal Code</label>
        <input
          id="postal-code"
          ref={postalCodeRef}
          defaultValue={draftPlace.content.properties.address?.["postal-code"] || ""}
          type="text"
          placeholder="Postal Code"
          onChange={() => updateDraft()}
        />
      </fieldset>
      <label htmlFor="type">Type</label>
      {typeDropdown(typeRef, draftPlace.content.properties.type || "", updateDraft)}
      <label htmlFor="status">Status</label>
      <select
        id="status"
        ref={statusRef}
        defaultValue={draftPlace.content.properties.status || ""}
        onChange={() => updateDraft()}
      >
        <option value="OPERATIONAL">Operational</option>
        <option value="CLOSED_TEMPORARILY">Closed Temporarily</option>
        <option value="CLOSED_PERMANENTLY">Closed Permanently</option>
      </select>
      <label htmlFor="website">Website</label>
      <input
        id="website"
        ref={websiteRef}
        defaultValue={draftPlace.content.properties.website || ""}
        type="text"
        placeholder="https://yondar.me"
        onChange={() => updateDraft()}
      />
      <label htmlFor="phone">Phone</label>
      <input
        id="phone"
        ref={phoneRef}
        defaultValue={draftPlace.content.properties.phone || ""}
        type="text"
        placeholder="+1 123 456 7890"
        onChange={() => updateDraft()}
      />
      <br />
      <FancyButton size={"lg"} onClick={publish}>
        {edit ? "Edit" : "Publish"} Place
      </FancyButton>
      <br />
      <br />
    </div>
  )
}