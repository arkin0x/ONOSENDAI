import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'

export default function Model({ url }) {
  const gltf = useGLTF(url)
  const modelRef = useRef()

  useFrame((state, delta) => {
    if (modelRef.current) {
      modelRef.current.rotation.y += delta
    }
  })

  return <primitive object={gltf.scene} ref={modelRef} />
}