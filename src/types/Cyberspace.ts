import { Event } from "nostr-tools"

export type Action = Event<333> & {
  kind: 333,
}
