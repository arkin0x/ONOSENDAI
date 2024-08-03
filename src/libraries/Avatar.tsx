import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { getSectorCoordinatesFromCyberspaceCoordinate } from "./Cyberspace"
import { SpawnModel } from "../components/Spawn"
import { ThreeAvatarTrail } from "../components/ThreeAvatarTrail"

type AvatarProps = {
  pubkey: string
}

/**
 * Avatar takes a pubkey and renders a ThreeAvatar while setting up action chain management and state storage of the avatar's actions.
 * @param pubkey string
 * @returns ThreeAvatar
 */
export const Avatar = ({pubkey}: AvatarProps) => {

  useActionChain(pubkey)

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinate(pubkey).toVector3()

  return <>
    <ThreeAvatar pubkey={pubkey} />
    <SpawnModel position={spawnPosition} />
    <ThreeAvatarTrail pubkey={pubkey}/>
  </>
}