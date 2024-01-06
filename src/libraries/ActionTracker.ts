import { Action, UnsignedAction, GenesisAction, LatestAction } from '../types/Cyberspace'
import { createUnsignedDriftAction, createUnsignedGenesisAction, isGenesisAction } from './Cyberspace'

// Define your state variables
let genesisAction: GenesisAction | null = null
let latestAction: LatestAction | null = null

// Define a function to initialize the genesis action
export function updateGenesisAction(action: GenesisAction) {
  genesisAction = action
}

// Define a function to update the latest action
export function updateLatestAction(action: LatestAction) {
  latestAction = action
}

// Define a function to get the genesis action
export function getGenesisAction(): GenesisAction | null {
  return genesisAction
}

// Define a function to get the latest action
export function getLatestAction(): LatestAction | null {
  return latestAction
}
