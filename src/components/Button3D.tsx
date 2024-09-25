import { Text } from '@react-three/drei'
import COLORS from "../data/Colors";

interface Button3DProps {
  text: string;
  buttonColor?: string|number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  onClick?: () => void;
}
      
export function Button3D({text, buttonColor, position, rotation, scale, onClick}: Button3DProps) {

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh
        position={[0, 0, 0]}
        onClick={() => onClick && onClick()}
      >
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshBasicMaterial color={buttonColor || COLORS.ORANGE} />
      </mesh>
      <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        {text.toUpperCase()}
      </Text>
    </group>
  )
}