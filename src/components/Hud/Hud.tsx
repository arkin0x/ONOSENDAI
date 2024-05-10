import { Text } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useContext, useEffect, useRef } from "react"
import { AxesHelper, Vector3 } from "three"
import { IdentityContextType } from "../../types/IdentityType"
import { IdentityContext } from "../../providers/IdentityProvider"
import { AvatarContext } from "../../providers/AvatarContext"
import { extractActionState } from "../../libraries/Cyberspace"

export const Hud = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const {simulatedState} = useContext(AvatarContext)

  const pubkey = identity.pubkey

  if (!simulatedState[pubkey]) return null

  const {cyberspaceCoordinate, sectorId, sectorPosition, plane, velocity, rotation, time} = extractActionState(simulatedState[pubkey])

  const x = 1
  const y = 1
  const r = Math.PI / 6

  return (
    <>
    <group>
      {/* <Axes position={[-1,-2,0]} rotation={[0,0,0]} /> */}
      <CoordinateText position={{x, y: y + 1}} rotation={[0, r, 0]} text={sectorPosition.x.toFixed(8)} align="left" />
      <CoordinateText position={{x, y: y + 3}} rotation={[0, r, 0]} text={sectorPosition.y.toFixed(8)} align="left" />
      <CoordinateText position={{x, y: y + 5}} rotation={[0, r, 0]} text={sectorPosition.z.toFixed(8)} align="left" />
      <CoordinateText position={{x, y: y + 7}} rotation={[0, r, 0]} text={'SECTOR ' + sectorId} align="left" />
      <CoordinateText position={{x, y: y + 9}} rotation={[0, r, 0]} text={'COORD ' + cyberspaceCoordinate.toUpperCase()} align="left" />
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
}

export const CoordinateText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()

  const x = viewport.width * (props.position.x/100)
  const y = viewport.height * (props.position.y/100)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + x, -viewport.height / 2 + y, 0)

  return (
    <Text
      color="#ff9123"
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
    ref.current.rotation.setFromVector3(new Vector3().fromArray(props.rotation))
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