import { useContext } from 'react'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { Interface } from './Interface.tsx'
import { Intro } from './Intro.tsx'
import '../scss/Home.scss'

export const Home = () => {
  const { profileLoaded } = useContext<IdentityContextType>(IdentityContext)
  if (profileLoaded()) {
    return <Interface/>
  } else {
    return <Intro/>
  }
}
