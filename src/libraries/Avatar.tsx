import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { BufferGeometry, LineBasicMaterial, Quaternion, Vector3 } from "three"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { useContext, useEffect, useRef, useState } from "react"
import { AvatarContext } from "../providers/AvatarContext"
import { cyberspaceToSectorPosition, extractActionState, getSectorCoordinatesFromCyberspaceCoordinates } from "./Cyberspace"
import { useRotationStore } from "../store/RotationStore"
import { getTag } from "./Nostr"
import { useFrame } from "@react-three/fiber"
import { DecimalVector3 } from "./DecimalVector3"
import Decimal from "decimal.js"
import { SpawnModel } from "../components/Spawn"
import { ThreeAvatarTrail } from "../components/ThreeAvatarTrail"

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

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinates(pubkey).toVector3()

  return <>
    {/* <ThreeAvatarTrail position={sectorPosition} rotation={rotation} pubkey={pubkey}/> */}
    {/* <Tether pubkey={pubkey} sectorPosition={sectorPosition}/> */}
    <ThreeAvatar position={sectorPosition} rotation={rotation} />
    <SpawnModel position={spawnPosition} />
  </>
}

// function Tether({pubkey, sectorPosition}: {pubkey: string, sectorPosition: DecimalVector3}) {

//   const home = getSectorCoordinatesFromCyberspaceCoordinates(pubkey).toVector3()

//   const tetherMaterial = new LineBasicMaterial({ color: 0xff2323 })

//   const lineBufferGeometry = new BufferGeometry().setFromPoints([home, sectorPosition.toVector3()])

//   return (
//     <lineSegments scale={[1,1,1]} geometry={lineBufferGeometry} material={tetherMaterial} />
//   )
// }
