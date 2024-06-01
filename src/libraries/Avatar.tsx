import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { useContext, useEffect } from "react"
import { AvatarContext } from "../providers/AvatarContext"
import { extractActionState, getSectorCoordinatesFromCyberspaceCoordinates } from "./Cyberspace"
import { useRotationStore } from "../store/RotationStore"

type AvatarProps = {
  pubkey: string
}

/**
 * Avatar takes a pubkey and renders a ThreeAvatar while setting up action chain management and state storage of the avatar's actions and simulated state.
 * @param pubkey string
 * @returns ThreeAvatar
 */
export const Avatar = ({pubkey}: AvatarProps) => {

  useActionChain(pubkey)

  const {simulatedState} = useContext(AvatarContext)
  const {rotation} = useRotationStore()

  if (!simulatedState[pubkey]) {
    console.log('Avatar: no simulated state for', pubkey.substring(0,8)+".","Not rendering.")
    return null
  }

  const {sectorPosition, plane, velocity, time} = extractActionState(simulatedState[pubkey])

  return <ThreeAvatar position={sectorPosition} rotation={rotation} />
}

