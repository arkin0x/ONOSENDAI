import { NDKKind } from "@nostr-dev-kit/ndk"

export enum CyberspaceKinds {
  Construct = 331,
  Action = 333
}

export type CyberspaceNDKKinds = NDKKind & CyberspaceKinds