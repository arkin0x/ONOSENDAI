import { useCallback, useState } from 'react'
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors'
import useNDKStore from '../store/NDKStore'
import { useNavigate } from "react-router-dom"

export const ContinueButton = () => {
  const { initLocalKeyUser, initExtensionUser } = useNDKStore()
  const [color, setColor] = useState(COLORS.ORANGE)
  const navigate = useNavigate()

  const init = useCallback(() => {
    const userType = localStorage.getItem('useExtension') === 'true' ? 'extension' : 'local'

    if (userType === 'extension') {
      console.log('INIT EXTENSION USER')
      initExtensionUser(() => navigate('/interface'))
    } else {
      console.log('INIT LOCAL KEY USER')
      initLocalKeyUser(() => navigate('/interface'))
    }
    initLocalKeyUser(() => navigate('/interface'))
  },[initExtensionUser, initLocalKeyUser, navigate])

  return (
    <group onClick={init}>
      <mesh
        position={[0, 0, 0]}
        onPointerOver={() => setColor(COLORS.GREEN)}
        onPointerOut={() => setColor(COLORS.ORANGE)}
      >
        <boxGeometry args={[1, 0.2, 0.1]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Text position={[0, 0, 0.07]} color={COLORS.BLACK} fontSize={0.09} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
        CONTINUE
      </Text>
    </group>
  )
}