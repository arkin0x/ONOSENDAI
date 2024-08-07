import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { Euler } from "three"

const purple = '#78004e'
const blue = '#0062cd'
const teal = '#06a4a4'

const MAP_SIZE = 2**20

export function Grid() {
  const { camera } = useThree()

  camera.far = MAP_SIZE * 4

  useEffect(() => {
    camera.position.set(0, 0, 0)
    camera.rotation.set(0, 0, 0) // Pointing downward
  }, [camera])

  return (
    <group
      rotation={new Euler(-Math.PI/2, 0, 0)}
      position={[0, 0, -MAP_SIZE]}
    >
      <gridHelper args={[MAP_SIZE, 16, 0x682db5, 0x78004e]}  />
    </group>
  )
}