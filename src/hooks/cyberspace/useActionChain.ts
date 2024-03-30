/**
 * useActionChain.ts
 * 
 * @description Automatically assembles action chain for a given pubkey, stores in global context, valides the history and simulates the future.
 */
import { useContext, useEffect, useState } from "react"
import { Event } from 'nostr-tools';
import { NDKFilter } from "@nostr-dev-kit/ndk"
import { NDKContext } from "../../providers/NDKProvider"
import { CyberspaceKinds, CyberspaceNDKKinds } from "../../types/CyberspaceNDK"
import { actionChainIsValid } from "../cyberspace/actionChainIsValid"
import { AvatarContext } from "../../providers/AvatarContext"
import type {AvatarActionDispatched, AvatarSimulatedDispatched} from "../../providers/AvatarContext"

export const useActionChain = (pubkey: string) => {

  // get NDK, the library used to subscribe to relays and fetch events
  const ndk = useContext(NDKContext)

  const {actionState: state, dispatchActionState: dispatch} = useContext(AvatarContext)

  const actionChainState = state[pubkey]

  const [genesisId, setGenesisId] = useState<string|null>(null)
  
  /**
   * When historyComplete is true, the existing actionChain is complete from genesis to present and is ready for validation
   */
  const [historyComplete, setHistoryComplete] = useState<boolean>(false)

  // initialize avatar
  useEffect(() => {
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    dispatch({type: 'reset', pubkey: pubkey})

    // 1. query latest action for pubkey
    const latestActionFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], authors: [pubkey], limit: 1}
    const latestAction = ndk.subscribe(latestActionFilter, {closeOnEose: false})
      
    // define functions

    /**
     * Pass in an event to extract the genesis event ID from the tags
     * @param latestAction the most recent action for the pubkey
     * @returns the genesis event ID of the action chain for the most recent event
     */
    const getGenesisId = (latestAction: Event) => {
      try {
        const g = latestAction.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')?.[1]
        if (g) {
          // we got a genesis event id
          // is the current genesisId null?
          if (genesisId !== g) {
            // the genesisId changed. This triggers a re-initialization of the avatar because genesisId is a dependency of this useEffect.
            setGenesisId(g)
          } else {
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

    /**
     * callback for when an action is received from NDK
     * @param latestAction an action received from NDK
     */
    const onReceiveLatestAction = (latestAction: Event) => {
      // 2. on receive, get genesis id from action
      const action = {
        type: 'push',
        pubkey: pubkey,
        actions: [latestAction] as Event[],
      } as AvatarActionDispatched 
      dispatch(action)
      getGenesisId(latestAction)
    }

    // the latest action and all new actions will arrive here
    latestAction.on('event', onReceiveLatestAction)

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
      // 3. query all actions for genesisId (except genesis event itself because it does not have the 'e' tag referencing the genesis event)
      const fullActionHistoryFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], '#e': [genesisId]}
      const fullActionHistory = ndk.subscribe(fullActionHistoryFilter, {closeOnEose: false})

      /**
       * callback for when an action is received from NDK
       * @param receivedAction an action received from NDK
       */
      const onReceiveActions = (receivedAction: Event) => {
        // 4. on receive, store each action in some kind of state
        const action = {
          type: 'unshift',
          pubkey: pubkey,
          actions: [receivedAction] as Event[],
        } as AvatarActionDispatched 
        dispatch(action)
      }

      const getGenesisEvent = () => {
        // get genesis event
        ndk.fetchEvent(genesisId).then(genesisEvent => {
          console.log('FETCHING GENESIS EVENT', genesisEvent)
          const action = {
            type: 'unshift',
            pubkey: pubkey,
            actions: [genesisEvent] as Event[],
          } as AvatarActionDispatched
          dispatch(action)
          setHistoryComplete(true)
        })
      }

      // all actions from present back to the genesis event will arrive here
      fullActionHistory.on('event', onReceiveActions)
      // on historical EOSE, now get Genesis Event 
      fullActionHistory.on('eose', getGenesisEvent)

      // Clean up any subscriptions or resources in the cleanup function
      return () => {
        // Pseudocode: Clean up any subscriptions or resources
        fullActionHistory.stop()
      }
    }
  }, [ndk, genesisId])

  // validate from genesis action to latest action
  // once history is assembled, validate the action chain
  // 5. send past actions to web worker for validation
  // Pseudocode: validateActions(receivedActions);
  useEffect(() => {
    if (historyComplete){
      // TODO: 
      const isValid = actionChainIsValid(actionChainState)
      if (isValid) {
        console.log('action chain is valid')
      } else {
        console.error('action chain is invalid')
        // TODO: publish a new genesis event.
      }
    }
  }, [historyComplete, actionChainState])

  // simulate from latest action to present
  useEffect(() => {
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    if (genesisId){
      // if genesisId is set then we also have the most recent action, so we can simulate the future.
      // LEFTOFF
        // simulateWorker.postMessage(latestAction)
    }
  }, [ndk, genesisId, actionChainState])
}