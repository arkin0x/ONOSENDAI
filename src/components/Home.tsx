import { Interface } from './Interface.tsx'
import { Intro } from './Intro.tsx'
import '../scss/Home.scss'
import useNDKStore from '../store/NDKStore.ts'
import { IdentityProvider } from '../providers/IdentityProvider.tsx'

export const Home = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  console.log('Home: identity', identity)
  if (identity) {
    return (
      <IdentityProvider>
        <Interface/>
      </IdentityProvider>
    )
  } else {
    return <Intro/>
  }
}
