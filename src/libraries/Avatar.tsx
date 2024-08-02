import { useActionChain } from "../hooks/cyberspace/useActionChain"
import { ThreeAvatar } from "../components/ThreeAvatar"
import { getSectorCoordinatesFromCyberspaceCoordinates } from "./Cyberspace"
import { SpawnModel } from "../components/Spawn"
// import { ThreeAvatarTrail } from "../components/ThreeAvatarTrail"

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

  const spawnPosition = getSectorCoordinatesFromCyberspaceCoordinates(pubkey).toVector3()

  return <>
    {/* <ThreeAvatarTrail position={sectorPosition} rotation={rotation} pubkey={pubkey}/> */}
    {/* <Tether pubkey={pubkey} sectorPosition={sectorPosition}/> */}
    <ThreeAvatar pubkey={pubkey} />
    {/* <SpawnModel position={spawnPosition} /> */}
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
