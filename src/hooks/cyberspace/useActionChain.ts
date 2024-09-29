import { useEffect, useState, useCallback, useRef } from 'react'
import { Event } from 'nostr-tools'
import { NDKFilter, NDKSubscription } from "@nostr-dev-kit/ndk"
import { useAvatarStore } from "../../store/AvatarStore"
import useNDKStore from "../../store/NDKStore"
import { useEngineStore } from "../../store/EngineStore"
import { 
  CyberspaceKinds, 
  isGenesisAction, 
  extractGenesisId, 
  cyberspaceCoordinateFromHexString,
  extractCyberspaceActionState,
  CyberspaceAction,
  DecimalVector3,
  CYBERSPACE_SECTOR,
  relativeSectorIndex,
  Gibsons
} from "../../libraries/Cyberspace"
import { CyberspaceNDKKinds } from "../../types/CyberspaceNDK"
import Decimal from 'decimal.js'

export const useActionChain = (pubkey: string, isCurrentUser: boolean) => {
  const { ndk, getUser } = useNDKStore()
  const { actionState, dispatchActionState, getSimulatedState, getSimulatedSectorId } = useAvatarStore()
  const { respawn } = useEngineStore()
  const currentUser = getUser()
  
  const [latestAction, setLatestAction] = useState<Event | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [validationQueue, setValidationQueue] = useState<string[]>([])
  const liveSubscriptionRef = useRef<NDKSubscription | null>(null)

  const fetchLatestAction = useCallback(async () => {
    if (!ndk) return
    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
      authors: [pubkey],
      limit: 1
    }
    const event = await ndk.fetchEvent(filter)
    if (event) {
      const action = event.rawEvent() as Event
      dispatchActionState({ type: 'push', pubkey, actions: [action] })
      setLatestAction(action)
    } else if (isCurrentUser) {
      respawn()
    }
  }, [ndk, pubkey, isCurrentUser, respawn, dispatchActionState])

  const fetchActionHistory = useCallback(async (genesisId: string, since: number, until: number) => {
    if (!ndk) return
    setIsLoadingHistory(true)
    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
      authors: [pubkey],
      "#e": [genesisId],
      since,
      until
    }
    const events = await ndk.fetchEvents(filter)
    const actions = Array.from(events).map(event => event.rawEvent() as Event)
    dispatchActionState({ type: 'push', pubkey, actions })
    setIsLoadingHistory(false)
  }, [ndk, pubkey, dispatchActionState])

  const setupLiveSubscription = useCallback(() => {
    if (!ndk || !latestAction) return

    const filter: NDKFilter = {
      kinds: [CyberspaceKinds.Action as CyberspaceNDKKinds],
      authors: [pubkey],
      since: latestAction.created_at + 1
    }

    liveSubscriptionRef.current = ndk.subscribe(filter, {
      closeOnEose: false,
      groupable: false
    })

    liveSubscriptionRef.current.on('event', (event) => {
      const action = event.rawEvent() as Event
      dispatchActionState({ type: 'push', pubkey, actions: [action] })
      setLatestAction(action)
    })
  }, [ndk, pubkey, latestAction, dispatchActionState])

  /**
   * CURRENT USER ONLY
   */
  const updateValidationQueue = useCallback(() => {
    if (!currentUser || !latestAction) return

    const userSim = getSimulatedState(pubkey)! // this is available because latestAction was just pushed
    const userSimState = extractCyberspaceActionState(userSim)

    const sortedPubkeys = Object.keys(actionState)
      .filter(key => key !== currentUser.pubkey)
      .map((key): { pubkey: string, distance: Gibsons }=> {
        const avatarSim = getSimulatedState(pubkey)
        if (!avatarSim) return { pubkey: key, distance: new Decimal(Infinity) as Gibsons }
        const avatarSimState = extractCyberspaceActionState(avatarSim)
        const distance = userSimState.coordinate.vector.sub(avatarSimState.coordinate.vector).length() as Gibsons
        return { pubkey: key, distance }
      })
      .sort((a, b) => Decimal.sign(a.distance.sub(b.distance)))
      .filter(item => item.distance.lte(CYBERSPACE_SECTOR)) // we only care about avatars within 1 sector of us
      .map(item => item.pubkey)

    setValidationQueue(sortedPubkeys)
  }, [currentUser, latestAction, getSimulatedState, pubkey, actionState])

  useEffect(() => {
    fetchLatestAction()
  }, [fetchLatestAction])

  useEffect(() => {
    if (latestAction && !isGenesisAction(latestAction)) {
      const genesisId = extractGenesisId(latestAction)
      if (genesisId) {
        const localLatestAction = actionState[pubkey]?.[actionState[pubkey].length - 1]
        const since = localLatestAction ? localLatestAction.created_at : 0
        fetchActionHistory(genesisId, since, latestAction.created_at)
      }
    }
  }, [latestAction, fetchActionHistory, pubkey, actionState])

  useEffect(() => {
    setupLiveSubscription()
    return () => {
      if (liveSubscriptionRef.current) {
        liveSubscriptionRef.current.stop()
      }
    }
  }, [setupLiveSubscription])

  useEffect(() => {
    if (isCurrentUser) {
      updateValidationQueue()
    }
  }, [isCurrentUser, updateValidationQueue])

  /**
   * CURRENT USER ONLY
   */
  // Background processing for continuous validation
  useEffect(() => {
    if (!isCurrentUser) return

    const validateNextInQueue = async () => {
      if (validationQueue.length === 0) return

      const pubkeyToValidate = validationQueue[0]
      // Implement your validation logic here
      // This could involve fetching missing actions, verifying the action chain, etc.
      console.log(`Validating action chain for ${pubkeyToValidate}`)

      // After validation, remove the pubkey from the queue
      setValidationQueue(prev => prev.slice(1))
    }

    const intervalId = setInterval(validateNextInQueue, 5000) // Adjust interval as needed

    return () => clearInterval(intervalId)
  }, [isCurrentUser, validationQueue])

  return {
    latestAction,
    isLoadingHistory,
    validationQueue
  }
}