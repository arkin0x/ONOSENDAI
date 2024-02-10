import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Mesh, Quaternion, Vector3 } from 'three';

function Scene({setPointer, quaternion, setQuaternion}) {
  const [active, setActive] = useState(false)
  // const [quaternion, setQuaternion] = useState<Quaternion>(new Quaternion(0,0,0,1))
  const mesh = useRef<Mesh|null>(null)

  // This will be called on every frame
  useFrame((state) => {
    if (active) {
      // Update the quaternion here based on mouse movement
      const movementX = Math.min(1, Math.max(-1, -state.mouse.y * 1))
      const movementY = Math.min(1, Math.max(-1, state.mouse.x * 1))

      console.log(quaternion)
      setQuaternion(quaternion.clone().set(movementX, movementY, 0, 1).normalize())
    } else {
      // Reset the quaternion
      // setQuaternion(quaternion.clone().setFromAxisAngle(new Vector3(1, 0, 0), -90))
      // setQuaternion(quaternion.clone().set(0, 0, 0, 1))
    }
  })

  const onPointerDown = () => {
    // console.log('onPointerDown')
    setActive(true)
  }

  const onPointerUp = () => {
    // console.log('onPointerUp')
    setActive(false)
  }

  const onHover = () => {
    setPointer(true)
  }

  useEffect(() => {
    document.addEventListener('pointerup', onPointerUp)
    return () => {
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  // rotate the mesh geometry to point to -Z
  useEffect(() => {
    if (mesh.current) {
      mesh.current.geometry.rotateX(-Math.PI / 2)
    }
  }, [])

  return (
    <mesh ref={mesh}
      position={new Vector3(0, 0, -1)}
      quaternion={quaternion}
      onPointerDown={onPointerDown}
      onPointerEnter={onHover}
      onPointerLeave={() => setPointer(false)}
    >
      <coneGeometry args={[1, 4, 16]}/>
      <meshNormalMaterial color={'orange'}  />
    </mesh>
  );
}

export function DraggableCube({quaternion, setQuaternion}: {quaternion: Quaternion, setQuaternion: (q: Quaternion) => void}) {
  const [pointer, setPointer] = useState(false)
  return (
    <Canvas style={{maxHeight: '300px', cursor: pointer ? 'pointer' : 'default'}}>
      <ambientLight/>
      <pointLight color={0xffffff} position={[-10, 10, 10]} intensity={100} />
      <Scene setPointer={setPointer} quaternion={quaternion} setQuaternion={setQuaternion} />
    </Canvas>
  )
}
