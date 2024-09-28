import { useEffect, useState } from 'react'
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, TextureLoader } from 'three'
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors.ts'
import panel from '/warning-bg.png'
import { Spinner } from './Spinner.tsx'
import { useControlStore } from '../store/ControlStore.ts'

export function DerezzWarning({chainLength, callback}: {chainLength: number, callback: () => void}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [loading, setLoading] = useState(true)
  const { setControlState } = useControlStore()

  useEffect(() => {
    const loader = new TextureLoader()
    loader.load(panel, (loadedTexture) => {
      setTexture(loadedTexture)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <Spinner position={[0,0,-20]}/>
  }

  return (
    <group>
      <mesh position={[0, 0, 2]}>
        {/* logo */}
        <planeGeometry attach="geometry" args={[1280/720, 1]} />
        <meshBasicMaterial attach="material" map={texture} transparent={true} />
      </mesh>
      <group position={[0, 0, 2.1]}>
        <Text position={[0, .1, 0]} color={COLORS.RED} fontSize={0.077} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
          {`DISCARD CURRENT POW CHAIN\nOF ${chainLength} ACTIONS AND\nREZ AT PUBKEY COORDINATE?\n(THIS CANNOT BE UNDONE)`}
        </Text>
        <Text position={[0, -.22, 0]} color={COLORS.RED} fontSize={0.04} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
          {"TO AVOID INJURY OR BRAIN DEATH,\nPLEASE REMOVE NEUROACTIVE INTERFACES\nBEFORE CONTINUING"}
        </Text>
        <group position={[0, -.7, 0]}>
          <mesh onPointerUp={() => {
            setControlState({respawn: true}) 
            callback()
          }}>
            <boxGeometry args={[0.5, 0.2, 0.1]} />
            <meshBasicMaterial color={COLORS.BLACK} />
          </mesh>
          <lineSegments
            scale={[1, 1, 1]}
            geometry={new EdgesGeometry(new BoxGeometry(0.5, 0.2, 0.1))}
            material={new LineBasicMaterial({ color: COLORS.RED, linewidth: 1 })}
          />
        </group>
        <Text position={[0, -.7, .1]} color={COLORS.RED} fontSize={0.06} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'} anchorX={'center'} textAlign='center'>
          {"DEREZZ NOW"}
        </Text>
      </group>
    </group>
  )

}
