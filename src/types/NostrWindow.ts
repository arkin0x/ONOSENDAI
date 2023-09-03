import { Event, UnsignedEvent } from "nostr-tools"
import { SignableDraftPlace } from "./Place"

export type NostrWindow = {
  getPublicKey(): Promise<string>
  signEvent(event: UnsignedEvent | SignableDraftPlace) : Promise<Event>
}