import { Text } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { useEffect, useState } from "react"
import { Quaternion, Vector3 } from "three"
import COLORS from "../../data/Colors"
import { useSectorStore } from "../../store/SectorStore"
import { Event } from 'nostr-tools'
import { useAvatarStore } from "../../store/AvatarStore"
import useNDKStore from "../../store/NDKStore"
import { cyberspaceCoordinateFromHexString, CyberspaceLocalCoordinate, extractCyberspaceActionState } from "../../libraries/Cyberspace"
import { getTag } from "../../libraries/NostrUtils"
import { useRotationStore } from "../../store/RotationStore"


export const HyperjumpHud = () => {
  const { userCurrentSectorId, sectorState } = useSectorStore()
  const { getSimulatedState } = useAvatarStore()
  const { getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity!.pubkey
  const [hyperjump, setHyperjump] = useState<[Event,CyberspaceLocalCoordinate]>()
  const [pointDirection, setPointDirection] = useState<Quaternion>()
  const { rotation } = useRotationStore()

  // Effect: get closest hyperjump to avatar
  useEffect(() => {
    const interval = setInterval(() => {
      if (userCurrentSectorId && sectorState[userCurrentSectorId].hyperjumps.length > 0) {
        // get avatar local position
        const avatarSimState = getSimulatedState(pubkey)
        if (!avatarSimState) return
        const avatarCoord = extractCyberspaceActionState(avatarSimState).localCoordinate
        const hyperjumpCoords: [Event,CyberspaceLocalCoordinate][] = []
        // get hyperjumps local positions
        for (const hyperjump of sectorState[userCurrentSectorId].hyperjumps) {
          try {
            const hyperjumpHex = hyperjump.tags.find(getTag('C'))![1]
            const hyperjumpCoord = cyberspaceCoordinateFromHexString(hyperjumpHex).local
            hyperjumpCoords.push([hyperjump, hyperjumpCoord])
          } catch (e) {
            console.error(e)
          }
        }
        // sort hyperjumps by distance to avatar
        hyperjumpCoords.sort((a,b) => b[1].vector.toVector3().distanceTo(avatarCoord.vector.toVector3()) - a[1].vector.toVector3().distanceTo(avatarCoord.vector.toVector3()))
        // set the closest hyperjump to the state
        setHyperjump(hyperjumpCoords[0])
        // calculate the quaternion for the cone's rotation to point from the avatar position toward the closest hyperjump
        const direction = hyperjumpCoords[0][1].vector.toVector3().sub(avatarCoord.vector.toVector3()).normalize()
        const defaultDirection = new Vector3(0, 1, 0) // Assuming the cone points along the z-axis by default
        const quat = new Quaternion().setFromUnitVectors(defaultDirection, direction);
        const combinedQuat = new Quaternion().multiplyQuaternions(rotation, quat)
        setPointDirection(combinedQuat)
      }
    }, 50) // check every 5 seconds

    return () => clearInterval(interval)
  }, [userCurrentSectorId, sectorState, getSimulatedState, pubkey, rotation])

  const x = 99
  // const r = Math.PI / 5 // rotation
  // Calculate the divisor based on window width
  const windowWidth = window.innerWidth
  const divisor = Math.max(4, Math.floor(windowWidth / 600))
  const r = -Math.PI / divisor // rotation

  let line = 20

  const nextLine = () => {
    line += 2
    return line
  }

  // no hyperjump info to display
  if (!hyperjump) {
    return null
  }

  return (
    <>
    <group>
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'LOCAL HYPERJUMP'} align="right" color={COLORS.YELLOW} />
      {pointDirection && <DirectionCone x={90} y={nextLine()} rotation={[0, r, 0]} pointDirection={pointDirection} />}
    </group>
    </>
  )
}

function DirectionCone({ x, y, rotation, pointDirection }: { x: number, y: number, rotation: [number, number, number], pointDirection: Quaternion }) {
  const { viewport } = useThree()

  const _x = viewport.width * (x/100)
  const _y = viewport.height * (y/100)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + _x, -viewport.height / 2 + _y, 0)
  return (
    <group rotation={rotation} position={position}>
      <mesh 
        quaternion={pointDirection}
      >
        <coneGeometry args={[0.1, 1, 8]} />
        <meshBasicMaterial color={COLORS.ORANGE} wireframe />
      </mesh>
    </group>
  )
}

type CoordinateTextProps = {
  position: {
    x: number, // percent of viewport width
    y: number // percent of viewport height
  }
  rotation?: [number, number, number],
  text: string,
  align?: "left" | "center" | "right"
  color?: string | number
  fontSize?: number
}

export const CoordinateText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()

  const x = viewport.width * (props.position.x/100)
  const y = viewport.height * (props.position.y/100)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + x, -viewport.height / 2 + y, 0)

  return (
    <>
    <Text
      anchorX={props.align || 'center'}
      anchorY="bottom"
      color={ props.color || COLORS.BITCOIN}
      font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
      fontSize={ props.fontSize || 0.15}
      frustumCulled={true}
      letterSpacing={0.02}
      lineHeight={1}
      material-toneMapped={false}
      maxWidth={300}
      position={position}
      rotation={props.rotation || [0, 0, 0]}
      scale={[1, 1, 1]}
      textAlign="center"
    >
      {props.text}
    </Text>
    </>
  )
}
