import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh } from 'three'
import COLORS from '../../data/Colors'

export function Selector() {
  const geometry = new BufferGeometry()
  const vertices = new Float32Array([
    0, 1, 0, // Vertex 1
    -1, -1, 0, // Vertex 2
    1, -1, 0, // Vertex 3
  ])

  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))

  const material = new MeshBasicMaterial({ color: COLORS.ORANGE })
  const mesh = new Mesh(geometry, material)

  return <primitive object={mesh} />
}
