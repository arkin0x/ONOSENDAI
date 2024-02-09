import { useContext, useEffect } from "react"
import { useNavigate } from 'react-router-dom'
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { Spinner } from './Spinner'
import { localStorageKey } from '../libraries/EncryptAndStoreLocal'

export const Logout = () => {
  const {identity, setIdentity, setRelays, setContacts} = useContext<IdentityContextType>(IdentityContext)
  const navigate = useNavigate()

  useEffect(() => {
    const wipe = async () => {
      localStorage.removeItem('identity')
      localStorage.removeItem('relays')
      localStorage.removeItem('contacts')
      localStorage.removeItem('draftPlace')
      localStorage.removeItem(localStorageKey)
      localStorage.removeItem(localStorageKey+'v')
      localStorage.removeItem(localStorageKey+'s')
      window.location.href='/'
    }
    wipe()
  }, [navigate, identity, setIdentity, setRelays, setContacts])

  return (
    <div id="login">
      <h1>Logging Out...</h1>
      <Spinner/>
    </div>
  )
}