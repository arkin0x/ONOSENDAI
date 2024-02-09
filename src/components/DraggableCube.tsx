import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three';

function Scene() {
  const [active, setActive] = useState(false)
  const [quaternion, setQuaternion] = useState<Quaternion>(new Quaternion(0,0,0,1))

  // This will be called on every frame
  useFrame((state) => {
    if (active) {
      // Update the quaternion here based on mouse movement
      const movementX = Math.min(1, Math.max(-1, -state.mouse.y * 1))
      const movementY = Math.min(1, Math.max(-1, state.mouse.x * 1))

      setQuaternion(quaternion.clone().set(movementX, movementY, 0, 1).normalize())
    } else {
      // Reset the quaternion
      setQuaternion(quaternion.clone().set(0, 0, 0, 1))
    }
  })

  const onPointerDown = () => {
    console.log('onPointerDown')
    setActive(true)
  }

  const onPointerUp = () => {
    console.log('onPointerUp')
    setActive(false)
  }

  useEffect(() => {
    document.addEventListener('pointerup', onPointerUp)
    return () => {
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <mesh
      position={new Vector3(0, 0, 3)}
      quaternion={quaternion}
      onPointerDown={onPointerDown}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={'orange'}  />
    </mesh>
  );
}

export function DraggableCube() {
  return (
    <Canvas>
      <ambientLight/>
      <pointLight color={0xffffff} position={[-10, 10, 10]} intensity={100} />
      <Scene />
    </Canvas>
  )
}
