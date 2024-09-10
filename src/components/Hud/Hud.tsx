import { Text } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useContext, useRef, useState } from "react"
import { Vector3 } from "three"
import { IdentityContextType } from "../../types/IdentityType"
import { IdentityContext } from "../../providers/IdentityProvider"
import { cyberspaceVelocityToMAG, extractCyberspaceActionState, ExtractedCyberspaceActionState } from "../../libraries/Cyberspace"
import { useThrottleStore } from "../../store/ThrottleStore"
import { useControlStore } from "../../store/ControlStore"
import { useRotationStore } from "../../store/RotationStore"
import { useAvatarStore } from "../../store/AvatarStore"
import COLORS from "../../data/Colors"
import { generateSectorName } from "../../libraries/SectorName"


export const Hud = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const { actionState, getSimulatedState } = useAvatarStore()
  const [simulatedState, setSimulatedState] = useState<ExtractedCyberspaceActionState | null>(null)
  const { throttle } = useThrottleStore()
  const { controlState } = useControlStore()
  const { rotation } = useRotationStore()

  const pubkey = identity.pubkey
  const actionsRef = useRef(actionState[pubkey])

  useFrame(() => {
  const simulated = getSimulatedState(pubkey)
  // console.log('simulated', simulated)
    if (simulated) {
      setSimulatedState(extractCyberspaceActionState(simulated))
    }
    actionsRef.current = actionState[pubkey]
  })

  const x = 1
  // const r = Math.PI / 5 // rotation
  // Calculate the divisor based on window width
  const windowWidth = window.innerWidth
  const divisor = Math.max(4, Math.floor(windowWidth / 600))
  const r = Math.PI / divisor // rotation

  let line = 0

  const nextLine = () => {
    line += 2
    return line
  }

  if (!simulatedState) return null
  if (!actionsRef.current) return null

  return (
    <>
    <group>
      {/* <Axes position={[-6,-0.75,-1]} rotation={rotation.clone().invert()} /> */}
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'PLANE ' + simulatedState.plane.toUpperCase()} align="left" color={COLORS.DSPACE} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'Z: ' + simulatedState.localCoordinate.vector.z.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'Y: ' + simulatedState.localCoordinate.vector.y.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'X: ' + simulatedState.localCoordinate.vector.x.toFixed(2)} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={generateSectorName(simulatedState.sector.id).toUpperCase()} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'SECTOR ID ' + simulatedState.sector.id} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'COORD ' + simulatedState.coordinate.raw.toUpperCase()} align="left" />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`Z VELOCITY ${simulatedState.velocity.z.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`Y VELOCITY ${simulatedState.velocity.y.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`X VELOCITY ${simulatedState.velocity.x.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={`MAG ${cyberspaceVelocityToMAG(simulatedState.velocity).toFixed(2)}`} align="left" color={COLORS.ORANGE} />

      { rotation && <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'QUATERNION ' + rotation.x.toFixed(2) + '/' + rotation.y.toFixed(2) + '/' + rotation.z.toFixed(2) + '/' + rotation.w.toFixed(2)} align="left" color={COLORS.ORANGE} /> }

      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'THROTTLE ' + throttle + ' ' + '/'.repeat(throttle) + ' +' + (throttle === 0 ? 0 : Math.pow(2, throttle-10) * 60) + ' G/s'} align="left" color={COLORS.RED} />

      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'CHAIN LENGTH ' + actionsRef.current.length} align="left" color={COLORS.PURPLE} />

      { controlState.cruise 
        ? <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'CRUISE ENGAGED'} align="left" color={COLORS.PINK} /> 
        : <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'PRESS C FOR CRUISE'} align="left" color={COLORS.PURPLE} />  
      }

      <CoordinateText position={{x, y: 95}} rotation={[0, r, 0]} text={'PRESS T FOR TELEMETRY'} align="left" color={COLORS.PURPLE} fontSize={0.10} /> 

      {/* <group position={[1, 1, 0]} quaternion={rotation.clone().conjugate()}>
        <Grid scale={1} />
      </group> */}

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
    {/* <Text3D
      material={new MeshBasicMaterial({ color: props.color || "#ff9123" })}
      font={'/public/fonts/Monaspace Krypton ExtraLight_Regular.json'}
      size={0.15}
      height={0.01}
      lineHeight={1.5}
      position={position}
      bevelEnabled={true}
      bevelSize={0.001}
      bevelThickness={0.001}
      bevelOffset={0.001}
      
      rotation={props.rotation || [0, 0, 0]}
    >
        {props.text}
    </Text3D> */}
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

// const Axes = (props) => {
//   const ref = useRef<AxesHelper>()
//   const { scene } = useThree()

//   useEffect(() => {
//     ref.current = new AxesHelper(1)
//     ref.current.position.fromArray(props.position)
//     // ref.current.rotation.setFromVector3(new Vector3().fromArray(props.rotation))
//     ref.current.setRotationFromQuaternion(props.rotation)
//     scene.add(ref.current)

//     return () => { // Cleanup function to remove the helper when the component unmounts
//       scene.remove(ref.current!)
//     }
//   }, [scene, props]) // Dependency array. The effect will run again if these values change.

//   useFrame(() => {
//     if (ref.current) {
//       // Update the AxesHelper on each frame if needed
//       ref.current.updateMatrixWorld(true)
//     }
//   })

//   return null
// }