import { useContext, useEffect, useState } from "react"
import { useNavigate } from 'react-router-dom'
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { Spinner } from './Spinner'
import { NDKContext } from "../providers/NDKProvider"
import { defaultRelays } from "../libraries/Nostr"

export const Login = () => {
  const [loading, setLoading] = useState(false)
  const {identity, setIdentity, profileLoaded, setRelays} = useContext<IdentityContextType>(IdentityContext)
  const navigate = useNavigate()
  const {ndk} = useContext(NDKContext)

  useEffect(() => {
    if (!ndk) return
    const loadProfile = async () => {
      // retrieve profile
      const ndkUser = ndk.getUser({ pubkey: identity.pubkey })
      // FIXME: actually get the user's relays.
      const profile = await ndkUser.fetchProfile()
      profile!.created_at = +new Date()
      setIdentity(profile)
      setRelays(defaultRelays)
    }
    // console.log('Login: identity',identity)
    if (!identity) {
      // redirect to homepage if login page is accessed with no identity
      navigate('/')
    } else if (profileLoaded()) {
      // profile is still fresh. redirect to dashboard
      navigate('/')
    } else {
      // proceed with loading profile
      setLoading(true)
      loadProfile()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, identity, navigate /* profileLoaded, setIdentity, setRelays are ok to exclude */])

  return (
    <div id="login">
      <h1>Logging In...</h1>
      <label>With public key</label>
      <p>{identity ? identity.pubkey : null}</p>
      {loading ? <Spinner/> : null}
    </div>
  )
}