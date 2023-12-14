import { SignInButton } from './SignInButton'
import { SignUpButton } from './SignUpButton'
import '../scss/Home.scss'
import logo from '../assets/logo-cropped.png'
import CyberspaceViewer from './CyberspaceViewer.tsx'
import { useContext } from 'react'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'

export const Home = () => {
  const { isIdentityFresh } = useContext<IdentityContextType>(IdentityContext)

  if (isIdentityFresh()) {
    return <CyberspaceViewer/>
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