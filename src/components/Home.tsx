import { SignInButton } from './SignInButton'
import { SignUpButton } from './SignUpButton'
import '../scss/Home.scss'
import logo from '../assets/logo-cropped.png'
import { useContext } from 'react'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { Interface } from './Interface.tsx'

export const Home = () => {
  const { profileLoaded } = useContext<IdentityContextType>(IdentityContext)

  // return <Interface/>

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