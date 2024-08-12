import { useActionChain } from "../../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../Cyberspace/ThreeAvatar"
import { SpawnModel } from "../Cyberspace/Spawn"
import { ThreeAvatarTrail } from "../Cyberspace/ThreeAvatarTrail"
import { useAvatarStore } from "../../store/AvatarStore"
import { useEffect, useState } from "react"
import { useSectorStore } from "../../store/SectorStore"

type AvatarProps = {
  pubkey: string
}

/**
 * Avatar takes a pubkey and renders a ThreeAvatar while setting up action chain management and state storage of the avatar's actions.
 * @param pubkey string
 * @returns ThreeAvatar
 */
export const Avatar = ({pubkey}: AvatarProps) => {
  const [inGenesisSector, setInGenesisSector] = useState<boolean>(false)

  useActionChain(pubkey)

  const { currentSectorId } = useSectorStore()

  const { actionState, getLatestSectorId , getGenesisSectorId } = useAvatarStore()

  useEffect(() => {
    const latestSectorId = getLatestSectorId(pubkey)
    const genesisSectorId = getGenesisSectorId(pubkey)
    setInGenesisSector(latestSectorId === genesisSectorId)
  }, [currentSectorId, getGenesisSectorId, getLatestSectorId, pubkey])

  console.log('is genesis sector?',inGenesisSector)
  console.log(actionState[pubkey])

  return <>
    <ThreeAvatar pubkey={pubkey} />
    { inGenesisSector ? <SpawnModel pubkey={pubkey} /> : null }
    <ThreeAvatarTrail pubkey={pubkey}/>
  </>
}