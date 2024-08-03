import { Text } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useContext, useEffect, useRef, useState } from "react"
import { AxesHelper, Vector3 } from "three"
import { IdentityContextType } from "../../types/IdentityType"
import { IdentityContext } from "../../providers/IdentityProvider"
import { AvatarContext } from "../../providers/AvatarContext"
import { extractActionState, ExtractedActionState } from "../../libraries/Cyberspace"
import { useThrottleStore } from "../../store/ThrottleStore"
import { useControlStore } from "../../store/ControlStore"
import { useRotationStore } from "../../store/RotationStore"
import { LOGO_BLUE, LOGO_PURPLE, LOGO_TEAL } from "../ThreeMaterials"

const orange = '#ff9123'
const purple = '#78004e'
const blue = '#0062cd'
const teal = '#06a4a4'

export const Hud = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { actionState, getSimulatedState } = useContext(AvatarContext)
  const [simulatedState, setSimulatedState] = useState<ExtractedActionState | null>(null)
  const { throttle } = useThrottleStore()
  const { controlState } = useControlStore()
  const { rotation } = useRotationStore()

  const pubkey = identity.pubkey
  const actionsRef = useRef(actionState[pubkey])

  useFrame(() => {
  const simulated = getSimulatedState(pubkey)
    if (simulated) {
      setSimulatedState(extractActionState(simulated))
    }
    actionsRef.current = actionState[pubkey]
  })

  const x = 1
  const r = Math.PI / 6

  let line = 1

  const nextLine = () => {
    line += 2
    return line
  }

  if (!simulatedState) return null

  return (
    <>
    <group>
      <Axes position={[-6,-0.75,-1]} rotation={rotation.clone().invert()} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'Z: ' + simulatedState.sectorPosition.z.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'Y: ' + simulatedState.sectorPosition.y.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'X: ' + simulatedState.sectorPosition.x.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'SECTOR ' + simulatedState.sectorId} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'PLANE ' + simulatedState.plane.toUpperCase()} align="left" color={teal} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'COORD ' + simulatedState.cyberspaceCoordinate.toUpperCase()} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`Z VELOCITY ${simulatedState.velocity.z.mul(60).toFixed(2)} G/s`} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`Y VELOCITY ${simulatedState.velocity.y.mul(60).toFixed(2)} G/s`} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`X VELOCITY ${simulatedState.velocity.x.mul(60).toFixed(2)} G/s`} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'CHAIN LENGTH ' + actionsRef.current.length} align="left" color={purple} />

      { rotation && <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'QUATERNION ' + rotation.x.toFixed(2) + '/' + rotation.y.toFixed(2) + '/' + rotation.z.toFixed(2) + '/' + rotation.w.toFixed(2)} align="left" color={blue} /> }

      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'THROTTLE ' + throttle + ' ' + '/'.repeat(throttle) + ' +' + (throttle === 0 ? 0 : Math.pow(2, throttle-10) * 60) + ' G/s'} align="left" />

      { controlState.cruise 
        ? <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'CRUISE ENGAGED'} align="left" color={"#ff3377"} /> 
        : <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'PRESS X FOR CRUISE'} align="left" color={"#ff3377"} />  
      }

      <CoordinateText position={{x, y: 55}} rotation={[0, r, 0]} text={'PRESS T FOR TELEMETRY'} align="left" color={`#${LOGO_TEAL.toString(16).padStart(6, '0')}`} /> 

    </group>
    </>
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
  color?: string
}

export const CoordinateText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()

  const x = viewport.width * (props.position.x/100)
  const y = viewport.height * (props.position.y/100)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + x, -viewport.height / 2 + y, 0)

  return (
    <Text
      color={ props.color || "#ff9123"}
      fontSize={0.15}
      maxWidth={300}
      lineHeight={1}
      letterSpacing={0.02}
      textAlign="center"
      font="https://fonts.gstatic.com/s/roboto/v27/KFOmCnqEu92Fr1Mu4mxP.ttf"
      anchorX={props.align || 'center'}
      anchorY="bottom"
      position={position}
      rotation={props.rotation || [0, 0, 0]}
      scale={[1, 1, 1]}
      frustumCulled={true}
      material-toneMapped={false}
    >
      {props.text}
    </Text>
  )
}

const Axes = (props) => {
  const ref = useRef<AxesHelper>()
  const { scene } = useThree()

  useEffect(() => {
    ref.current = new AxesHelper(1)
    ref.current.position.fromArray(props.position)
    // ref.current.rotation.setFromVector3(new Vector3().fromArray(props.rotation))
    ref.current.setRotationFromQuaternion(props.rotation)
    scene.add(ref.current)

    return () => { // Cleanup function to remove the helper when the component unmounts
      scene.remove(ref.current!)
    }
  }, [scene, props]) // Dependency array. The effect will run again if these values change.

  useFrame(() => {
    if (ref.current) {
      // Update the AxesHelper on each frame if needed
      ref.current.updateMatrixWorld(true)
    }
  })

  return null
};