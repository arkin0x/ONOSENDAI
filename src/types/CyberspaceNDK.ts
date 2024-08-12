import { NDKKind } from "@nostr-dev-kit/ndk"

export enum CyberspaceKinds {
  Hyperjump = 321,
  Construct = 331,
  Action = 333,
}

export type CyberspaceNDKKinds = NDKKind & CyberspaceKinds