import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { IdentityContextType } from "../types/IdentityType"
import { IdentityContext } from "../providers/IdentityProvider"
import { getPublicKey } from "../libraries/NIP-07"
import { Text } from '@react-three/drei'
import COLORS from '../data/Colors'

export const SignInButton = () => {
  const { setIdentity } = useContext<IdentityContextType>(IdentityContext)
  const navigate = useNavigate()

  const signIn = async () => {
    // trigger sign in with extension
    const success = await getPublicKey()
    if (success) {
      // store pubkey in identity provider
      setIdentity({pubkey: success})
      // redirect to account page
      navigate('/login')
    } else {
      // trigger "key not set up yet" dialog
    }
  }

  return (
    <group onClick={signIn}>
      <mesh
        position={[-0.3, 0, 0]}
      >
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshBasicMaterial color={COLORS.ORANGE } />
      </mesh>
      <Text position={[-0.3, 0, 0.07]} color={COLORS.BLACK} fontSize={0.08} font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}>
       SIGN IN 
      </Text>
    </group>
  )
}