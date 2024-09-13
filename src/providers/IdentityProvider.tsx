import Loading from "../components/Loading"
import useNDKStore from "../store/NDKStore"
import { useEffect } from "react"

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const { initLocalKeyUser, initExtensionUser, fetchUserProfile, isUserLoaded, isProfileLoaded, getUser } = useNDKStore()

  const userType = localStorage.getItem('useExtension') === 'true' ? 'extension' : 'local'

  useEffect(() => {
    async function loadUser() {
      if (userType === 'extension') {
        console.log('INIT EXTENSION USER')
        await initExtensionUser()
      } else {
        console.log('INIT LOCAL KEY USER')
        await initLocalKeyUser()
      }
    }
    loadUser()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
      

  useEffect(() => {
    if (isProfileLoaded) return
    if (isUserLoaded) {
      console.log('USER LOADED')
      fetchUserProfile()
    } else {
      console.log('USER NOT LOADED YET')
    }
  }, [fetchUserProfile, isProfileLoaded, isUserLoaded])

  if (!isUserLoaded) {
    return <Loading/>
  } else {
    console.log('IdentityProvider: isUserLoaded', isUserLoaded, getUser() )
  }

  return children
}