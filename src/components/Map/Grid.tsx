import { ReactNode } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { Euler } from "three"

const purple = '#78004e'
const blue = '#0062cd'
const teal = '#06a4a4'



export function Grid({children, size}: {children?: ReactNode, size: number}) {
  const { camera } = useThree()

  camera.far = size * 2

  camera.position.set(0, 0, 0)
  camera.rotation.set(0, 0, 0)

  return (
    <group
      rotation={new Euler(-Math.PI/2, 0, 0)}
      position={[0, 0, -size]}
    >
      <gridHelper args={[size, 16, 0x682db5, 0x78004e]}  />
      {children}
    </group>
  )
}