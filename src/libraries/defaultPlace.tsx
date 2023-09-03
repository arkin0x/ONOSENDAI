import { DraftPlace } from '../types/Place'

export const defaultPlace: DraftPlace = {
  kind: 37515,
  tags: [
    ["d", "New Place"],
    ["g", ""],
    ["alt", "This event represents a place. View it on go.yondar.me/"],
    // ["expiration", (+new Date)/1000 + 60 * 60 * 24 * 365] // optional expiration date. This tag should not be present if no expiration date is desired.
  ],
  content: {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [0, 0]
    },
    properties: {
      name: "New Place",
      description: "A new place on the map",
      type: "point_of_interest",
    }
  }
}

export const freshDefaultPlace = (): DraftPlace => {
  return JSON.parse(JSON.stringify(defaultPlace))
}
