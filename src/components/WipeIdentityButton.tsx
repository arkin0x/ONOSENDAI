import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { IdentityContextType } from "../types/IdentityType"
import { IdentityContext } from "../providers/IdentityProvider"
import { localStorageKey } from '../libraries/EncryptAndStoreLocal'

export const WipeIdentityButton = () => {
  const { identity, setIdentity } = useContext<IdentityContextType>(IdentityContext)
  const navigate = useNavigate()

  const wipe = () => {
    localStorage.removeItem(localStorageKey)
    localStorage.removeItem(localStorageKey+'v')
    localStorage.removeItem(localStorageKey+'s')
    navigate('/')
    setIdentity(null)
  }

  const initiateWipe = () => {
    const localIdentity = localStorage.getItem(localStorageKey)
    if (!localIdentity) {
      // we are using a signing extension
      const sure = confirm('Are you sure you want to wipe your identity from Yondar and log out? \n\nYou can only log back in with the same identity if you have your private key in a nostr signing extension like nos2x or Alby.\n\nIf you are already using a signing extension, it is safe to continue.')
      if (sure) {
        wipe()
      }
    } else {
      // we have a locally stored keypair
      const sure = confirm('Are you sure you want to wipe your identity from Yondar and log out? \n\nYou can only log back in with the same identity if you Export your private key and set up a nostr signing extension like nos2x or Alby.')
      if (sure) {
        const sure2 = confirm('Have you exported your identity? \n\nIf not, you will not be able to log back in.')
        if (sure2) {
          const sure3 = confirm('Last chance! Clicking OK will permanently delete your identity if you haven\'t exported it. \n\nAre you sure you want to do this?')
          if (sure3) {
            wipe()
          }
        }
      }
    }
  }

  if (!identity) {
    return null
  } else {
    return (
      <button className="danger" onClick={initiateWipe}>Delete Identity and Logout</button>
    )
  }
}