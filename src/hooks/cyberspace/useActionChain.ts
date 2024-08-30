/**
 * useActionChain.ts
 * 
 * @description Automatically assembles action chain for a given pubkey, stores in global context, valides the history and simulates the future.
 */
import { useContext, useEffect, useState } from "react"
import { Event } from 'nostr-tools'
import { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk"
import { NDKContext } from "../../providers/NDKProvider"
import { CyberspaceNDKKinds } from "../../types/CyberspaceNDK"
import { CyberspaceKinds } from "../../libraries/Cyberspace"
import { isGenesisAction } from "../../libraries/Cyberspace"
// import { validateActionChain } from "./validateActionChain"
import { useAvatarStore, AvatarActionDispatched } from "../../store/AvatarStore"

export const useActionChain = (pubkey: string) => {
  const {ndk} = useContext(NDKContext)
  const [runInitializeOnce, setRunInitializeOnce] = useState<boolean>(false) // this is used to run the initialization useEffect only once
  const {actionState, dispatchActionState} = useAvatarStore()
  const [genesisId, setGenesisId] = useState<string|null>(null)
  const actionChainState = actionState[pubkey]
  
  // When historyComplete is true, the existing actionChain is complete from genesis to present and is ready for validation
  const [historyComplete, setHistoryComplete] = useState<boolean>(false)

  // Reset: if actionChainState is empty, we need to reset other variables.
  useEffect(() => {
    if (actionChainState && actionChainState.length === 0) {
      setRunInitializeOnce(false)
      setGenesisId(null)
      setHistoryComplete(false)
    }
  }, [actionChainState])

  // Initialize: set up subscription for latest action and get genesisId from it.
  useEffect(() => {
    if (runInitializeOnce) return // this effect should only run once
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    setRunInitializeOnce(true)
    dispatchActionState({type: 'reset', pubkey: pubkey})

    // define subscription for latest action only.
    const latestActionFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], authors: [pubkey], limit: 1}
    const latestAction = ndk.subscribe(latestActionFilter, {closeOnEose: false})
      
    /**
     * Pass in an event to extract the genesis event ID from the tags
     * @param latestAction the most recent action for the pubkey
     * @returns the genesis event ID of the action chain for the most recent event
     */
    const getGenesisId = (latestAction: Event) => {
      try {
        const isGen = isGenesisAction(latestAction) // check if the action is a genesis action
        if(isGen) setGenesisId(latestAction.id) // if it is, set the genesisId
        else {
          // the action is not a genesis action. Check if it refers to a genesis tag.
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
        }
      } catch (e) {
        console.error('Error getting genesis tag', e)
        // FIXME: recover from this error
        return null
      }
    }

    /**
     * Callback for when an action is received from NDK
     * @param latestAction an action received from NDK
     */
    const onReceiveLatestAction = (latestAction: NDKEvent) => {
      // console.log('Receive action:', latestAction, latestAction.id, 'for pubkey:', pubkey)
      const event = latestAction.rawEvent() as Event
      // 2. on receive, get genesis id from action
      const action = {
        type: 'push',
        pubkey: pubkey,
        actions: [event] as Event[],
      } as AvatarActionDispatched 
      dispatchActionState(action)
      getGenesisId(event)
    }

    // the latest action and all new actions will arrive here
    latestAction.on('event', onReceiveLatestAction)

    // Clean up any subscriptions or resources in the cleanup function
    return () => {
      // Pseudocode: Clean up any subscriptions or resources
      latestAction.stop()
    }
  // we only want to run this once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk])

  /** 
   * Gather action history for genesisId once it is set by the previous useEffect.
  */
  useEffect(() => {
    if (!ndk) return // wait until ndk is ready; this effect will run again when ndk is ready
    if (genesisId){
      // Query all actions for genesisId (except genesis event itself because it does not have the 'e' tag referencing the genesis event)
      const fullActionHistoryFilter: NDKFilter = {kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds], '#e': [genesisId]}
      const fullActionHistory = ndk.subscribe(fullActionHistoryFilter, {closeOnEose: false})

      /**
       * Callback for when an action is received from NDK
       * @param receivedAction an action received from NDK
       */
      const onReceiveActions = (receivedAction: NDKEvent) => {
        const event = receivedAction.rawEvent() as Event
        // 4. on receive, store each action in some kind of state
        const action = {
          type: 'unshift',
          pubkey: pubkey,
          actions: [event] as Event[],
        } as AvatarActionDispatched 
        dispatchActionState(action)
      }

      const getGenesisEvent = () => {
        // get genesis event
        ndk.fetchEvent(genesisId).then(genesisEvent => {
          if (!genesisEvent) {
            // TODO: give option to restart action chain or refresh page to try again.
            throw new Error('Failed to get genesis event.')
          }
          const event = genesisEvent.rawEvent() as Event
          const action = {
            type: 'unshift',
            pubkey: pubkey,
            actions: [event] as Event[],
          } as AvatarActionDispatched
          dispatchActionState(action)
          setHistoryComplete(true)
          console.log('Received all actions for current chain.')
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
  }, [ndk, genesisId, pubkey, dispatchActionState])

  /**
   * Once history is assembled in previous useEffect, validate the action chain.
  */
  useEffect(() => {
    if (historyComplete){
      // TODO: 
      const isValid = true//validateActionChain(actionChainState)
      if (isValid) {
        // console.log('action chain is valid')
      } else {
        // console.error('action chain is invalid')
        // TODO: publish a new genesis event.
      }
    }
  }, [historyComplete, actionChainState])
}