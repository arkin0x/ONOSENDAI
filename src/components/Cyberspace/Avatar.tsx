import { useActionChain } from "../../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "./ThreeAvatar"
import { SpawnModel } from "./Spawn"
import { ThreeAvatarTrail } from "./ThreeAvatarTrail"
import { useAvatarStore } from "../../store/AvatarStore"
import { memo, useEffect, useState } from "react"
import { useSectorStore } from "../../store/SectorStore"

type AvatarProps = {
  pubkey: string
}

/**
 * Avatar takes a pubkey and renders a ThreeAvatar while setting up action chain management and state storage of the avatar's actions. Memoization prevents unnecessary re-renders or reloads of the action chain.
 * @param pubkey string
 * @returns ThreeAvatar
 */
export const Avatar = memo(({pubkey}: AvatarProps) => {
  const [inGenesisSector, setInGenesisSector] = useState<boolean>(false)

  useActionChain(pubkey)

  // when this changes, we should re-check/run effects
  const { userCurrentSectorId } = useSectorStore()

  const { actionState, getSimulatedSectorId, getGenesisSectorId } = useAvatarStore()

  useEffect(() => {
    const simulatedSectorId = getSimulatedSectorId(pubkey)
    const genesisSectorId = getGenesisSectorId(pubkey)
    setInGenesisSector(simulatedSectorId === genesisSectorId)
  }, [actionState, userCurrentSectorId, getGenesisSectorId, getSimulatedSectorId, pubkey])

  return <>
    <ThreeAvatar pubkey={pubkey} />
    { inGenesisSector ? <SpawnModel pubkey={pubkey} /> : null }
    {/* <ThreeAvatarTrail pubkey={pubkey}/> */}
  </>
})