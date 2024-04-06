import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { IdentityContextType } from "../types/IdentityType"
import { IdentityContext } from "../providers/IdentityProvider"
import { getPublicKey } from "../libraries/NIP-07"

export const SignInButton = () => {
  const { setIdentity, profileLoaded } = useContext<IdentityContextType>(IdentityContext)
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
  if (profileLoaded()) {
    return (
      <div className="column">
      You're already logged in!
      <br/>
      <br/>
      <button type='button' onClick={() => navigate('/login')}>Go Yondar</button>
      </div>
    )
  } else {
    return (
      <button type='button' onClick={signIn}>Sign in with Extension</button>
    )
  }
}