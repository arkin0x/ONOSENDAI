import { useThree } from "@react-three/fiber"
import { Vector3 } from "three"
import { Text } from '@react-three/drei'
import COLORS from "../../data/Colors"

type CoordinateTextProps = {
  position: {
    x: number, // percent of viewport width
    y: number // percent of viewport height
  }
  rotation?: [number, number, number],
  text: string,
  align?: "left" | "center" | "right"
  anchorY?: number | "top" | "bottom" | "top-baseline" | "middle" | "bottom-baseline" | undefined
  color?: string | number
  fontSize?: number
  maxWidth?: number
}

export const CoordinateText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()

  const x = viewport.width * (props.position.x/100)
  const y = viewport.height * (props.position.y/100)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + x, -viewport.height / 2 + y, 0)

  return (
    <Text
      anchorX={props.align || 'center'}
      anchorY={props.anchorY || "bottom"}
      color={ props.color || COLORS.BITCOIN}
      font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
      fontSize={ props.fontSize || 0.15}
      frustumCulled={true}
      letterSpacing={0.02}
      lineHeight={1}
      material-toneMapped={false}
      maxWidth={props.maxWidth || 300}
      position={position}
      rotation={props.rotation || [0, 0, 0]}
      scale={[1, 1, 1]}
      textAlign={props.align || 'center'}
    >
      {props.text}
    </Text>
  )
}