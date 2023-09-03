// Function to encrypt the private key and save it to localStorage
const defaultPassword = 'nostridentitypassword'
export const localStorageKey = 'storens'

function setPassword() {
  const newpass = prompt('Secure your new identity with a password:')
  if (newpass === null) return false
  if (newpass === '') {
    const sure = confirm('Your identity be stored unencrypted. This is less safe. OK? Cancel to enter a password.')
    if (!sure) {
      return setPassword()
    } else {
      return ''
    }
  } else {
    alert('Write down your password somewhere safe. You will need it to export your identity.\n\n'+newpass+'\n\nIf you lose your password, you will not be able to use this identity on any other device or app.\n\n Click OK once you have written down your password.')
    return newpass
  }
}

function recallPassword(reason: 'export' | 'signing'){
  return prompt(`Enter your password to unlock your identity for ${reason}. \n\nLeave blank if you did not encrypt your identity with a password.`)
}

export async function encryptAndStorePrivateKey(privateKeyHex: string): Promise<boolean>{
    const encoder = new TextEncoder()
    const privateKeyBytes = encoder.encode(privateKeyHex)

    const proceed = setPassword()

    if (proceed === false) {
      return false
    }

    const password = encoder.encode(defaultPassword + proceed)
    // Derive a key from a password
    const keyMaterial = await crypto.subtle.importKey(
        'raw', password, { name: 'PBKDF2' }, false, ['deriveKey']
    )
    
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 1000000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )

    // Encrypt the private key
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        privateKeyBytes
    )

    // Store encrypted data, salt, and iv in localStorage
    localStorage.setItem(localStorageKey, JSON.stringify(Array.from(new Uint8Array(encrypted))))
    localStorage.setItem(localStorageKey+'v', JSON.stringify(Array.from(iv)))
    localStorage.setItem(localStorageKey+'s', JSON.stringify(Array.from(salt)))

    return true
}

// Function to decrypt the private key from localStorage
export async function decryptPrivateKey(reason: 'export' | 'signing') {
    const recall = recallPassword(reason)
    if (recall === null){
      // user canceled
      return false
    }
    const password = new TextEncoder().encode(defaultPassword + recall)

    const keyMaterial = await crypto.subtle.importKey(
        'raw', password, { name: 'PBKDF2' }, false, ['deriveKey']
    )

    const encryptedData = {
      data: JSON.parse(localStorage.getItem(localStorageKey) || '{}'),
      iv: JSON.parse(localStorage.getItem(localStorageKey+'v') || '{}'),
      salt: JSON.parse(localStorage.getItem(localStorageKey+'s') || '{}')
    }

    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new Uint8Array(encryptedData.salt), iterations: 1000000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(encryptedData.iv) },
        key,
        new Uint8Array(encryptedData.data)
    )

    return new TextDecoder().decode(decrypted)
}
