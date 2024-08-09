import { useGLTF } from '@react-three/drei'
import { GLTF } from 'three-stdlib'

type GLTFResult = GLTF & {
  nodes: {
    [key: string]: THREE.Mesh
  }
  materials: {
    [key: string]: THREE.Material
  }
}

export function SpawnModel(props: JSX.IntrinsicElements['group']) {
  const { nodes, materials } = useGLTF('/src/assets/spawn.glb') as GLTFResult

  return (
    <group {...props} scale={[3,3,3]} dispose={null}>
      {/* hexes */}
      <mesh 
        geometry={nodes.BoundaryHexBack.geometry}
        material={materials.Hex}
      />
      <mesh 
        geometry={nodes.BoundaryHexFront.geometry}
        material={materials.Hex}
      />
      <mesh 
        geometry={nodes.BoundaryHexMiddleWarning.geometry}
        material={materials.HexYellow}
      />
      {/* cube */}
      <mesh 
        geometry={nodes.Cube.geometry}
        material={materials.Cube}
      />
      {/* triads */}
      <mesh 
        geometry={nodes.LargeTriadLeft.geometry}
        material={materials.LargeTriad}
      />
      <mesh 
        geometry={nodes.LargeTriadRight.geometry}
        material={materials.LargeTriad}
      />
      <mesh 
        geometry={nodes.LargeTriadTop.geometry}
        material={materials.LargeTriad}
      />
      <mesh 
        geometry={nodes.SmallTriadLeft.geometry}
        material={materials.SmallTriad}
      />
      <mesh 
        geometry={nodes.SmallTriadRight.geometry}
        material={materials.SmallTriad}
      />
      <mesh 
        geometry={nodes.SmallTriadBottom.geometry}
        material={materials.SmallTriad}
      />
    </group>
  )
}

useGLTF.preload('/src/assets/spawn.glb')