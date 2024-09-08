import { SignInButton } from './SignInButton'
import { SignUpButton } from './SignUpButton'
import '../scss/Home.scss'
import logo from '../assets/logo-cropped.png'
import { useContext, useEffect } from 'react'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { Interface } from './Interface.tsx'
import { NDKContext } from '../providers/NDKProvider.tsx'
import { useEngineStore } from '../store/EngineStore.ts'

export const Home = () => {
  const { identity, profileLoaded } = useContext<IdentityContextType>(IdentityContext)

  const { publishEvent } = useContext(NDKContext)
  const setPublishEvent = useEngineStore(state => state.setPublishEvent)
  const setPubkey = useEngineStore(state => state.setPubkey)

  useEffect(() => {
    setPublishEvent(publishEvent)
  }, [publishEvent, setPublishEvent])

  useEffect(() => {
    if (identity.pubkey) {
      setPubkey(identity.pubkey)
    }
  }, [identity.pubkey, setPubkey])

  if (profileLoaded()) {
    return <Interface/>
  } else {
    return (
      <div id="home">
        <div className="wrapper">
          <img className="logo" src={ logo } alt="ONOSENDAI logo" />
          <br/>
          <div className="button-row">
            <SignInButton/><SignUpButton/>
          </div>
        </div>
      </div>
    )
  }
}