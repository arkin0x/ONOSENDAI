import { Text } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { useEffect, useState } from "react"
import { Vector3 } from "three"
import COLORS from "../../data/Colors"
import { useSectorStore } from "../../store/SectorStore"


export const SpawnHud = () => {
  const { userCurrentSectorId, sectorState } = useSectorStore()
  const [genesis, setGenesis] = useState<boolean>()

  useEffect(() => {
    if (userCurrentSectorId && sectorState[userCurrentSectorId]) {
      setGenesis(sectorState[userCurrentSectorId]?.isGenesis)
    }
  }, [userCurrentSectorId, sectorState])

  const x = 99
  // const r = Math.PI / 5 // rotation
  // Calculate the divisor based on window width
  const windowWidth = window.innerWidth
  const divisor = Math.max(4, Math.floor(windowWidth / 600))
  const r = -Math.PI / divisor // rotation

  let line = 0

  const nextLine = () => {
    line += 2
    return line
  }

  if (!genesis) {
    return null
  }

  return (
    <>
    <group>
      <CoordinateText position={{x, y: nextLine()}} rotation={[0, r, 0]} text={'GENESIS SECTOR'} align="right" color={COLORS.PINK} />
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
