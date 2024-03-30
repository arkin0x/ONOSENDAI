import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { useContext, useEffect } from "react"
import { AvatarContext } from "../providers/AvatarContext"
import { extractActionState, getSectorCoordinatesFromCyberspaceCoordinates } from "./Cyberspace"

type AvatarProps = {
  pubkey: string
}

export const Avatar = ({pubkey}: AvatarProps) => {

  useActionChain(pubkey)

  const {simulatedState} = useContext(AvatarContext)

  const {sectorPosition, plane, velocity, rotation, time} = extractActionState(simulatedState[pubkey])

  return <ThreeAvatar position={sectorPosition.toArray().map(x => parseFloat(x))} />
}

