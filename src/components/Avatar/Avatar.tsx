import { useActionChain } from "../../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../Cyberspace/ThreeAvatar"
import { getSectorCoordinatesFromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { SpawnModel } from "../Cyberspace/Spawn"
import { ThreeAvatarTrail } from "../Cyberspace/ThreeAvatarTrail"

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

  // TODO: <SpawnModel> should take a pubkey and determine if it is within the current sector. Or, it should be a child of <Sector> and render at the pubkey location for every unique pubkey in the sector (based on querying any and all 333 events.) 
  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinate(pubkey).toVector3()

  return <>
    <ThreeAvatar pubkey={pubkey} />
    <SpawnModel position={spawnPosition} />
    <ThreeAvatarTrail pubkey={pubkey}/>
  </>
}