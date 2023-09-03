import { useContext, useState } from 'react'
import { IdentityContextType } from "../types/IdentityType"
import { IdentityContext } from "../providers/IdentityProvider"
import { decryptPrivateKey, localStorageKey } from '../libraries/EncryptAndStoreLocal'

export const ExportIdentityButton = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)

  const [showExport, setShowExport] = useState<JSX.Element|null>(null)
  const [wrongPassword, setWrongPassword] = useState(false)

  // what is the type of e?
  const exportIdentity = async (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    try {
      const sk = await decryptPrivateKey('export')
      if (sk === false) {
        return
      }
      const pk = identity.pubkey
      const output = (<>
      <p>Here are your secret and public keys. They can be used to bring your identity and data to any <a href="https://www.nostrapps.com/" target="_blank" rel="noopener noreferrer">nostr-compatible application.</a></p>
      <p><a href="https://heynostr.com/" target="_blank" rel="noopener noreferrer">What is nostr?</a> It's a decentralized communication protocol that makes all apps interoperable.</p>
      <p>The public key is like your public user profile. It may be shared freely.</p>
      <p>Anyone with this secret key can impersonate you, so keep it secret! We recommend using a signing extension like nos2x or Alby to safely store your secret key, which allows you to login to nostr apps without revealing it.</p>
      <div className="flexcol">
        <label className="full">⚠️ Secret Key:</label>
        <input disabled readOnly type="password" value={sk}/>
        <button onClick={() => navigator.clipboard.writeText(sk)}>Copy</button>
      </div>
      <div className="flexcol">
        <label className="full">Public Key:</label>
        <input disabled readOnly type="input" value={pk}/>
        <button onClick={() => navigator.clipboard.writeText(pk)}>Copy</button>
      </div>
      </>)

      setShowExport(output)
    } catch (e) {
      setWrongPassword(true)
    }
  }

  const closeButton = () => {
    setShowExport(null)
    setWrongPassword(false)
  }

  if (!localStorage.getItem(localStorageKey)) {
    return null
  } else if (!showExport && !wrongPassword) {
    return (
      <button onClick={exportIdentity}>Export Identity</button>
    )
  } else if (!showExport && wrongPassword) {
    return (
      <>
        <button onClick={exportIdentity}>Export Identity</button>
        <div className="secret export messagebox full" onClick={e => e.stopPropagation()}>
          <span>Wrong password. Please try again.</span>
          <button className="close" onClick={closeButton}>&times;</button>
        </div>
      </>
    )
  } else if (showExport) {
    return (
      <div className="secret export messagebox full" onClick={e => e.stopPropagation()}>
        {showExport}
        <button className="close" onClick={closeButton}>&times;</button>
      </div>
    )
  }
}