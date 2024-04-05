import { useContext, useEffect, useState } from "react"
import { useNavigate } from 'react-router-dom'
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { Spinner } from './Spinner'
import { NDKContext } from "../providers/NDKProvider"

export const Login = () => {
  const [loading, setLoading] = useState(false)
  const {identity, setIdentity, isIdentityFresh, setRelays} = useContext<IdentityContextType>(IdentityContext)
  const navigate = useNavigate()
  const ndk = useContext(NDKContext)

  useEffect(() => {
    if (!ndk) return
    const loadProfile = async () => {
      // retrieve profile
      const ndkUser = ndk.getUser({ pubkey: identity.pubkey })
      const userRelays = ndkUser.relayUrls
      const profile = await ndkUser.fetchProfile()
      console.log('Login: relays',userRelays)
      setIdentity(profile)
      setRelays(userRelays)
      console.log('fresh:', isIdentityFresh(), identity.created_at)
    }
    // console.log('Login: identity',identity)
    // redirect to homepage if login page is accessed with no identity
    if (!identity) {
      console.log('beans')
      navigate('/')
    } else if (isIdentityFresh()) {
      console.log('fresh beans')
      // profile is still fresh. redirect to dashboard
      navigate('/')
    } else {
      // proceed with loading profile
      setLoading(true)
      loadProfile()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, identity, navigate /* isIdentityFresh, setIdentity, setRelays are ok to exclude */])

  return (
    <div id="login">
      <h1>Logging In...</h1>
      <label>With public key</label>
      <p>{identity ? identity.pubkey : null}</p>
      {loading ? <Spinner/> : null}
    </div>
  )
}