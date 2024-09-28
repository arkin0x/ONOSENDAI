import { useCallback, useEffect, useState } from "react"
import { Event } from 'nostr-tools'
import { NDKFilter } from "@nostr-dev-kit/ndk"
import { CyberspaceNDKKinds } from "../../types/CyberspaceNDK"
import { CyberspaceKinds, factoryHex256Bit } from "../../libraries/Cyberspace"
import { isGenesisAction } from "../../libraries/Cyberspace"
import { useAvatarStore } from "../../store/AvatarStore"
import useNDKStore from "../../store/NDKStore"
import { useEngineStore } from "../../store/EngineStore"

export const useActionChain = (pubkey: string) => {

  // Stores
  const {ndk, getUser} = useNDKStore()
  const identity = getUser()
  const userPubkey = identity!.pubkey // SectorManager can't load unless we have a user pubkey, so we can assume it's here.
  const {actionState, dispatchActionState, setUserHistoryComplete} = useAvatarStore()
  const actions = actionState[pubkey]

  // State
  const [latestAction, setLatestAction] = useState<Event | null>(null)
  const [minimumHistoryComplete, setMinimumHistoryComplete] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Functions
  const completeUserHistory = useCallback(() => {
    // we only care to do this if it's the user.
    if (userPubkey === pubkey) {
      setUserHistoryComplete(true)
    }
    // trigger event replacement routine
    setMinimumHistoryComplete(true)
  }, [userPubkey, pubkey, setUserHistoryComplete])

  function resetMalformedChain(e: unknown) {
    console.error('Malformed action event.', e)
    // reset chain
    dispatchActionState({type: 'reset', pubkey})
    completeUserHistory()
  }

  // Effects
useEffect(() => {
    if (!ndk) return
    if (!minimumHistoryComplete) return
    if (!actions || actions.length === 0) return

    if (currentIndex >= actions.length) {
      console.log('restarting search for signed events')
      setCurrentIndex(0)
      return
    }

    console.log('replacing events with signed versions')

    const interval = setInterval(async () => {
      const chunk = actions.slice(currentIndex, currentIndex + 20)
      const unsignedActions = chunk.filter(action => !action.sig)

      console.log('unsigned actions', unsignedActions)

      if (unsignedActions.length > 0) {
        const ids = unsignedActions.map(action => action.id)
        const filter: NDKFilter = {
          kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
          ids,
        }

        // Query the Nostr network with the filter
        const results = await ndk.fetchEvents(filter)

        // Process the results
        // convert results to an array
        const resultsArray = Array.from(results).map(event => event.rawEvent() as Event)

        console.log('replacing events', resultsArray)

        dispatchActionState({type: 'push', pubkey, actions: resultsArray})
      }

      setCurrentIndex(prevIndex => prevIndex + 20)

      if (currentIndex >= actions.length) {
        clearInterval(interval)
      }
    }, 5000) // Adjust the interval time as needed

    return () => clearInterval(interval)
  }, [actions, minimumHistoryComplete, currentIndex, ndk, dispatchActionState, pubkey])

  // get most recent action for pubkey
  useEffect(() => {
    async function getLatestAction() {
      if (!ndk) return
      const latestActionFilter: NDKFilter = {
        kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
        authors: [pubkey],
        limit: 1
      }
      const latestAction = await ndk.fetchEvent(latestActionFilter, {closeOnEose: true})
      console.log('latest action', latestAction?.rawEvent())
      if (latestAction) {
        setLatestAction(latestAction.rawEvent() as Event)
      } else {
        // we couldn't find any actions for this pubkey. This is a new user (or we're having an unlucky networking issue)
        // the combination of userHistoryComplete=true and no actions means the user is new.
        console.log('no actions found; respawning')
        useEngineStore.getState().respawn()
        completeUserHistory()
      }
    }
    getLatestAction()
  }, [completeUserHistory, dispatchActionState, ndk, pubkey])

  // determine slice of history to query for between latest local state and latest action received.
  useEffect(() => {
    async function fetchActionHistory(filters: NDKFilter[]){
      const actionHistory = await ndk?.fetchEvents(filters)
      const actionArray = Array.from(actionHistory ?? []).map(event => event.rawEvent() as Event)
      if (actionArray.length > 0) {
        dispatchActionState({type: 'push', pubkey, actions: actionArray})
      }
      completeUserHistory()
    }
    let since = 0
    if (latestAction) {
      let isLatestActionGenesis 
      try {
        isLatestActionGenesis = isGenesisAction(latestAction)
      } catch (e) {
        resetMalformedChain(e)
        return 
      }
      if (isLatestActionGenesis) {
        // the latest action is a genesis action. We don't need to query for history. Reset the history and replace with the genesis action.
        console.log('latest action is genesis', latestAction)
        dispatchActionState({type: 'push', pubkey, actions: [latestAction]})
        completeUserHistory()
        return
      }
      // the latest action is not a genesis action. We need to query for history.
      let latestGenesisId
      try {
        const tag = latestAction.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')?.[1]
        if (!tag) throw new Error('No genesis tag found.')
        latestGenesisId = factoryHex256Bit(tag) // will throw if genesis id is malformed
      } catch (e) {
        resetMalformedChain(e)
        return
      }
      const until = latestAction.created_at
      if (actions && actions.length > 0) {
        // get most recent action in store for pubkey
        const latestStateAction = actions[actions.length - 1]
        // check that they share the same genesis event id
        try {
          if (latestStateAction.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')?.[1] !== latestGenesisId) {
            // the genesis event ids do not match. Reset our local events. We will re-query the entire history.
            dispatchActionState({type: 'reset', pubkey})
            completeUserHistory()
            return
          } else {
            // genesis event ids match.
            // set since to the latest action in the store.
            since = latestStateAction.created_at
          }
        } catch (e) {
          resetMalformedChain(e)
          return
        }
      }
      if (since > until) {
        // the latest action in the store is newer than the latest action received.
        // did we get a random action from the relay that isn't the newest? oh well.
        // simply push the latest action to the store and set history complete.
        // if it's a duplicate it will be filtered out of state.
        dispatchActionState({type: 'push', pubkey, actions: [latestAction]})
        return
      }
      // determine the genesis event id and limit the scope of the query to that.
      const actionHistoryFilter: NDKFilter = {
        kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
        authors: [pubkey],
        since: since,
        until: until,
        "#e": [latestGenesisId]
      }
      const genesisFilter: NDKFilter = {
        kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
        authors: [pubkey],
        ids: [latestGenesisId]
      }
      console.log('fetching rest of action history', actionHistoryFilter, genesisFilter)
      fetchActionHistory([actionHistoryFilter, genesisFilter])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAction, pubkey]) // don't include actions in the dependency array. This would cause unnecessary re-renders.

}