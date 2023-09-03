import { nip19 } from "nostr-tools"
import { DraftPlace, GooglePlaceStatus, GooglePlaceType, Place } from "../types/Place"
import { RelayList } from "../types/NostrRelay"
import { getTag } from "./Nostr"

/**
 * 
 * @returns a DraftPlace object based on the form data
 */
export const createDraftPlace = (
  name: string,
  geohash: string,
  naddr: string,
  description: string,
  type: GooglePlaceType,
  coords: [number, number],
  abbrev?: string,
  streetAddress?: string,
  locality?: string,
  region?: string,
  countryName?: string,
  postalCode?: string,
  status?: GooglePlaceStatus,
  website?: string,
  phone?: string
) => {
  const newPlace: DraftPlace = {
    kind: 37515,
    tags: [
      ["d", name],
      ["g", geohash],
      [
        "alt",
        `This event represents a place. View it on https://go.yondar.me/place/${naddr}`,
      ],
    ],
    content: {
      type: "Feature",
      geometry: {
        coordinates: [coords[0], coords[1]],
        type: "Point",
      },
      properties: {
        name,
        abbrev,
        description,
        address: {
          "street-address": streetAddress,
          locality,
          region,
          "country-name": countryName,
          "postal-code": postalCode,
        },
        type,
        status,
        website,
        phone,
      },
    },
  }
  return newPlace
}


export const beaconToDraftPlace = (beacon: Place, relayList: RelayList) => {
  // attempt to gather the properiets we aren't sure of
  const gtag = beacon.tags.find(getTag("g"))
  const geohash = gtag ? gtag[1] : ""
  const alttag = beacon.tags.find(getTag("alt"))
  const previousAlt = alttag ? alttag[1] : null
  let alt
  if (!previousAlt) {
    // no previous alt tag with naddr, create a new one
    const naddr = createNaddr(beacon.pubkey, beacon.content.properties.name, relayList)
    alt = `This event represents a place. View it on https://go.yondar.me/place/${naddr}`
  } else {
    // use the previous alt tag
    alt = previousAlt
  }
  return createDraftPlace(
    beacon.content.properties.name,
    geohash,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    alt,
    beacon.content?.properties?.description,
    beacon.content?.properties?.type,
    beacon.content?.geometry?.coordinates,
    beacon.content?.properties?.abbrev,
    beacon.content?.properties?.address?.["street-address"],
    beacon.content?.properties?.address?.locality,
    beacon.content?.properties?.address?.region,
    beacon.content?.properties?.address?.["country-name"],
    beacon.content?.properties?.address?.["postal-code"],
    beacon.content?.properties?.status,
    beacon.content?.properties?.website,
    beacon.content?.properties?.phone
  )
}

export const createNaddr = (pubkey: string, name: string, relays: RelayList) => {
  const naddr = nip19.naddrEncode({
    pubkey: pubkey,
    // TODO: replace with relay provider
    relays,
    kind: 37515,
    identifier: name,
  })
  return naddr
}