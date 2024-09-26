import { Text } from '@react-three/drei'
import COLORS from "../data/Colors"
import { BoxLineGeometry } from 'three/examples/jsm/geometries/BoxLineGeometry.js'

interface Button3DProps {
  text: string
  buttonColor?: string|number
  display: 'solid' | 'wireframe'
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  onClick?: () => void
}
      
export function Button3D({text, buttonColor, display, position, rotation, scale, onClick}: Button3DProps) {

  const geo = new BoxLineGeometry(0.5, 0.2, 0.1)

  return (
    <group 
        onClick={() => onClick && onClick()}
    >
      {/* { display === 'solid' ? <mesh>
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshBasicMaterial color={buttonColor || COLORS.ORANGE} />
      </mesh> : null }
      { display === 'wireframe' ? <lineSegments
        geometry={geo}
      >
        <lineBasicMaterial color={buttonColor || COLORS.ORANGE} />
      </lineSegments> : null } */}
      <wireframeGeometry args={[geo]}>
        <lineBasicMaterial color={buttonColor || COLORS.ORANGE} />
      </wireframeGeometry>
      <Text position={[0, 0, 0.07]} color={buttonColor} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        {text.toUpperCase()}
      </Text>
    </group>
  )
}