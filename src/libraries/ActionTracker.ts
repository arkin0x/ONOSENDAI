import { Event } from 'nostr-tools'

// Define your state variables
let genesisAction: Event | null = null
let latestAction: Event | null = null

// Define a function to initialize the genesis action
export function updateGenesisAction(action: Event) {
  genesisAction = action
}

// Define a function to update the latest action
export function updateLatestAction(action: Event) {
  latestAction = action
}

// Define a function to get the genesis action
export function getGenesisAction(): Event | null {
  return genesisAction
}

// Define a function to get the latest action
export function getLatestAction(): Event | null {
  return latestAction
}
