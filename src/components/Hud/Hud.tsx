import { useFrame, useThree } from "@react-three/fiber"
import { useRef, useState, useEffect } from "react"
import { Vector3 } from "three"
import { CyberspacePlane, cyberspaceVelocityToMAG, extractCyberspaceActionState, ExtractedCyberspaceActionState, cyberspaceCoordinateFromHexString, CyberspaceLocalCoordinate } from "../../libraries/Cyberspace"
import { useThrottleStore } from "../../store/ThrottleStore"
import { useControlStore } from "../../store/ControlStore"
import { useRotationStore } from "../../store/RotationStore"
import { useAvatarStore } from "../../store/AvatarStore"
import { useSectorStore } from "../../store/SectorStore"
import COLORS from "../../data/Colors"
import { generateSectorName } from "../../libraries/SectorName"
import useNDKStore from "../../store/NDKStore"
import { CoordinateText } from "./CoordinateText"
import { Event } from 'nostr-tools'
import { getTag } from "../../libraries/NostrUtils"
import { convertSeconds } from "../../libraries/utils"

export const Hud = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { actionState, getSimulatedState } = useAvatarStore()
  const { throttle } = useThrottleStore()
  const { controlState } = useControlStore()
  const { rotation } = useRotationStore()
  const { userCurrentSectorId, sectorState } = useSectorStore()
  const [genesis, setGenesis] = useState<boolean>(false)
  const [hyperjump, setHyperjump] = useState<[Event, CyberspaceLocalCoordinate] | undefined>()

  const pubkey = identity!.pubkey
  const actionsRef = useRef(actionState[pubkey])

  const windowWidth = window.innerWidth
  const divisor = Math.max(4, Math.floor(windowWidth / 600))
  const r = Math.PI / divisor // rotation
  const simulatedStateRef = useRef<ExtractedCyberspaceActionState>()
  const distanceRef = useRef<number>(0)

  useFrame(() => {
    const simulated = getSimulatedState(pubkey)
    if (simulated) {
      simulatedStateRef.current = extractCyberspaceActionState(simulated)
    }
    actionsRef.current = actionState[pubkey]

    // Update distance to hyperjump
    if (hyperjump && simulatedStateRef.current) {
      const avatarCoord = simulatedStateRef.current.localCoordinate
      const distance = hyperjump[1].vector.toVector3().distanceTo(avatarCoord.vector.toVector3())
      distanceRef.current = distance
    }
  })

  useEffect(() => {
    if (userCurrentSectorId && sectorState[userCurrentSectorId]) {
      setGenesis(sectorState[userCurrentSectorId].isGenesis)
      
      // Find closest hyperjump
      if (sectorState[userCurrentSectorId].hyperjumps.length > 0) {
        const avatarSimState = getSimulatedState(pubkey)
        if (!avatarSimState) return
        const avatarCoord = extractCyberspaceActionState(avatarSimState).localCoordinate
        const hyperjumpCoords: [Event, CyberspaceLocalCoordinate][] = []
        
        for (const jump of sectorState[userCurrentSectorId].hyperjumps) {
          try {
            const hyperjumpHex = jump.tags.find(getTag('C'))![1]
            const hyperjumpCoord = cyberspaceCoordinateFromHexString(hyperjumpHex).local
            hyperjumpCoords.push([jump, hyperjumpCoord])
          } catch (e) {
            console.error(e)
          }
        }
        
        hyperjumpCoords.sort((a, b) => 
          b[1].vector.toVector3().distanceTo(avatarCoord.vector.toVector3()) - 
          a[1].vector.toVector3().distanceTo(avatarCoord.vector.toVector3())
        )
        
        setHyperjump(hyperjumpCoords[0])
      } else {
        setHyperjump(undefined)
      }
    }
  }, [userCurrentSectorId, sectorState, getSimulatedState, pubkey])

  let lineHeightLeft = 0
  let lineHeightRight = 0

  const nextLineLeft = (n = 0) => {
    lineHeightLeft += 2 + n
    return lineHeightLeft
  }

  const nextLineRight = (n = 0) => {
    lineHeightRight += 2 + n
    return lineHeightRight
  }

  if (!simulatedStateRef.current) return null
  if (!actionsRef.current) return null

  const speed = 
    simulatedStateRef.current.velocity.x.pow(2)
      .add(simulatedStateRef.current.velocity.y.pow(2))
      .add(simulatedStateRef.current.velocity.z.pow(2))
      .mul(60).sqrt().toNumber()

  const eta = speed ? Math.floor(distanceRef.current / speed) : null
  const etaParts = convertSeconds(eta || Infinity)

  return (
    <>
      <group>
        {/* Left-side HUD items */}
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'PLANE ' + simulatedStateRef.current.plane.toUpperCase()} align="left" color={simulatedStateRef.current.plane === CyberspacePlane.DSpace ? COLORS.DSPACE : COLORS.ISPACE} />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'Z: ' + simulatedStateRef.current.localCoordinate.vector.z.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'Y: ' + simulatedStateRef.current.localCoordinate.vector.y.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'X: ' + simulatedStateRef.current.localCoordinate.vector.x.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={generateSectorName(simulatedStateRef.current.sector.id).toUpperCase()} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'SECTOR ID ' + simulatedStateRef.current.sector.id} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'COORD ' + simulatedStateRef.current.coordinate.raw.toUpperCase()} align="left" />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={`Z VELOCITY ${simulatedStateRef.current.velocity.z.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={`Y VELOCITY ${simulatedStateRef.current.velocity.y.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={`X VELOCITY ${simulatedStateRef.current.velocity.x.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={`MAG ${cyberspaceVelocityToMAG(simulatedStateRef.current.velocity).toFixed(2)}`} align="left" color={COLORS.ORANGE} />

        { rotation && <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'QUATERNION ' + rotation.x.toFixed(2) + '/' + rotation.y.toFixed(2) + '/' + rotation.z.toFixed(2) + '/' + rotation.w.toFixed(2)} align="left" color={COLORS.ORANGE} /> }

        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'THROTTLE ' + throttle + ' ' + '▶'.repeat(throttle) + ' +' + (throttle === 0 ? 0 : Math.pow(2, throttle-10) * 60) + ' G/s'} align="left" color={COLORS.RED} />

        <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'CHAIN LENGTH ' + actionsRef.current.length} align="left" color={COLORS.PURPLE} />

        { controlState.cruise 
          ? <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'CRUISE ENGAGED'} align="left" color={COLORS.PINK} /> 
          : <CoordinateText position={{x: 1, y: nextLineLeft()}} rotation={[0, r, 0]} text={'PRESS C FOR CRUISE'} align="left" color={COLORS.PURPLE} />  
        }

        <CoordinateText position={{x: 1, y: 95}} rotation={[0, r, 0]} text={'PRESS T FOR TELEMETRY'} align="left" color={COLORS.PURPLE} fontSize={0.10} /> 
        <CoordinateText position={{x: 1, y: 93}} rotation={[0, r, 0]} text={'PRESS H FOR HISTORY'} align="left" color={COLORS.PURPLE} fontSize={0.10} /> 

        {/* Right-side HUD items */}
        {genesis && (
          <CoordinateText position={{x: 99, y: nextLineRight()}} rotation={[0, -r, 0]} text={'GENESIS SECTOR'} align="right" color={COLORS.PINK} />
        )}
        {hyperjump && (
          <>
            <CoordinateText position={{x: 99, y: nextLineRight()}} rotation={[0, -r, 0]} text={`${speed.toFixed(2)} G/s`} align="right" color={COLORS.ORANGE} />
            {eta && <CoordinateText position={{x: 99, y: nextLineRight()}} rotation={[0, -r, 0]} text={`${etaParts.days}d ${etaParts.hours}h ${etaParts.minutes}m ${etaParts.seconds}s`} align="right" color={COLORS.ORANGE} />}
            <CoordinateText position={{x: 99, y: nextLineRight()}} rotation={[0, -r, 0]} text={`${distanceRef.current.toFixed(speed > 1000 ? 0 : 2)} Gibsons`} align="right" color={COLORS.YELLOW} />
            <CoordinateText position={{x: 99, y: nextLineRight()}} rotation={[0, -r, 0]} text={'LOCAL HYPERJUMP'} align="right" color={COLORS.YELLOW} />
          </>
        )}
      </group>
    </>
  )
}