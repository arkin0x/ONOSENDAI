import { useContext, useEffect, useReducer, useState } from "react"
import { NDKContext } from "../providers/NDKProvider"
import { Event } from "nostr-tools"
import { CyberspaceKinds, CyberspaceNDKKinds } from "../types/CyberspaceNDK"
import { NDKFilter } from "@nostr-dev-kit/ndk"

type AvatarProps = {
  pubkey: string
}

type ActionReducer = {
  type: 'push' | 'unshift' | 'reset',
  payload?: Event
}

export const Avatar = ({pubkey}: AvatarProps) => {

  const ndk = useContext(NDKContext)

  const [actionChain, reduceActions] = useReducer((state: Event[], action: ActionReducer): Event[] => {
    console.log('reducer: event', action.payload || action.type)
    if (action.type === 'reset') return [] as Event[]
    if (action.type === 'unshift') return [action.payload, ...state] as Event[]
    if (action.type === 'push') return [...state, action.payload] as Event[]
    return state
  }, [])

  const [genesisId, setGenesisId] = useState<string|null>(null)
  const [historyComplete, setHistoryComplete] = useState<boolean>(false)

  // initialize avatar
  useEffect(() => {
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    reduceActions({type: 'reset'})

    // 1. query latest action for pubkey
    const latestActionFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], authors: [pubkey], limit: 1}
    const latestAction = ndk.subscribe(latestActionFilter, {closeOnEose: false})
      
    const getGenesisId = (latestAction: Event) => {
      try {
        const g = latestAction.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')?.[1]
        if (g) {
          // we got a genesis event id
          // is the current genesisId null?
          if (genesisId !== g) {
            // the genesisId changed. This triggers a re-initialization of the avatar.
            setGenesisId(g)
          } else if (genesisId === g) {
            // the genesisId is the same. noop.
          }
          return g // return the id
        } else {
          // FIXME: recover from this error
          return null // failed to get genesis ID
        }
      } catch (e) {
        console.error('Error getting genesis tag', e)
        // FIXME: recover from this error
        return null
      }
    }

    const onReceiveLatestAction = (latestAction: Event) => {
      // 2. on receive, get genesis id from action
      const action = {
        payload: latestAction as Event,
        type: 'push'
      } as ActionReducer
      reduceActions(action)
      getGenesisId(latestAction)
    }

    // the latest action and all new actions will arrive here
    latestAction.on('event', onReceiveLatestAction)

    // need to work these in yet --
    const simulateAction = (latestAction: Action) => {
      // 6. send latest action to another web worker for simulation
      // Pseudocode: simulate(latestAction);
    };

    const simulate = (actionToSimulate: Action) => {
      // Pseudocode: Implement web worker logic for action simulation
    };

    const onReceiveSimulationResults = (simulationResults: any) => {
      // 7. receive results of simulation web worker and convert it for display
      // Pseudocode: convertSimulationResults(simulationResults);
    };

    const convertSimulationResults = (simulationResults: any) => {
      // Pseudocode: Implement logic to convert simulation results for display
    };

    // Call the necessary functions to initiate the process
    // Pseudocode: ndk.queryLatestAction(pubkey, onReceiveLatestAction);

    // Clean up any subscriptions or resources in the cleanup function
    return () => {
      // Pseudocode: Clean up any subscriptions or resources
      latestAction.stop()
    }
  }, [ndk, pubkey, genesisId])

  // gather action history for genesisId
  useEffect(() => {
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    if (genesisId){
      // 3. query all actions for genesisId
      const fullActionHistoryFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], '#e': [genesisId]}
      const fullActionHistory = ndk.subscribe(fullActionHistoryFilter, {closeOnEose: false})

      // define functions
      const onReceiveActions = (receivedAction: Event) => {
        // 4. on receive, store each action in some kind of state
        const action = {
          payload: receivedAction as Event,
          type: 'unshift'
        } as ActionReducer
        reduceActions(action)
      }

      const getGenesisEvent = () => {
        // get genesis event
        ndk.fetchEvent(genesisId).then(genesisEvent => {
          console.log('FETCHING GENESIS EVENT', genesisEvent)
          const action = {
            payload: genesisEvent as Event,
            type: 'unshift'
          } as ActionReducer
          reduceActions(action)
          setHistoryComplete(true)
        })
      }

      // all actions from present back to the genesis event will arrive here
      fullActionHistory.on('event', onReceiveActions)
      // on historical EOSE, send to web worker for validation
      fullActionHistory.on('eose', getGenesisEvent)

      // Clean up any subscriptions or resources in the cleanup function
      return () => {
        // Pseudocode: Clean up any subscriptions or resources
        fullActionHistory.stop()
      }
    }
  }, [genesisId])

  // once history is assembled, validate the action chain
  // 5. send past actions to web worker for validation
  // Pseudocode: validateActions(receivedActions);
  useEffect(() => {
    if (historyComplete){
      const validateActions = () => {
        // Pseudocode: Implement web worker logic for action validation
        // validateWorker.postMessage(actionChain)
        // console.log('validateActions', actionChain)
        // DEBUG BELOW
        actionChain.forEach(event => {
          const e = {
            id: event.id,
            // kind: event.kind,
            // content: event.content,
            created_at: event.created_at,
            // pubkey: event.pubkey,
            // sig: event.sig,
            tags: event.tags
          }
          console.log(e.created_at, e.id)
        })

      }
      validateActions()
    }
  }, [historyComplete])


  // 8. return a visible avatar for threejs
  return null
}

