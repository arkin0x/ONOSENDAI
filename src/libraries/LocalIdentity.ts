import { decrypt, encrypt } from 'nostr-tools/nip49'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { getPublicKey, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils'

const LOGN = 16

export function initializeIdentity() {
  // const pubkey = loadPublicKey()

  console.log('Initializing identity')

  if (!localStorage.getItem('nip49')) {
    return createEncryptedKey();
  }
}

export function loadNpub(): string | undefined {
  return localStorage.getItem('npub') || undefined
}

export function loadPublicKey(): string | undefined {
  const npub = localStorage.getItem('npub')
  if (!npub) {
    console.warn('No public key found in local storage')
    return
  }
  const decoded = nip19.decode(npub)
  console.log('decoded', decoded)
  return decoded.data as string
}

function savePublicKey(privateKey: Uint8Array) {
  const publicKey = getPublicKey(privateKey)
  const npub = nip19.npubEncode(publicKey)
  localStorage.setItem('npub', npub)
}

function setRandomDefaultPassword(length: number) {
  const bytes = window.crypto.getRandomValues(new Uint8Array(length))
  const hexString = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('nip49-default', hexString)
}

export function removeDefaultPassword(newPassword: string) {
  const defaultPassword = localStorage.getItem('nip49-default')
  if (!defaultPassword) {
    console.warn('No default password found in local storage')
    return
  }
  const encryptedPrivateKey = loadEncryptedKey()
  if (!encryptedPrivateKey) {
    console.warn('No encrypted private key found in local storage')
    return
  }
  const rawPrivateKeyBytes = decrypt(encryptedPrivateKey, defaultPassword)
  const newEncryptedPrivateKey = encrypt(rawPrivateKeyBytes, newPassword, LOGN)
  localStorage.setItem('nip49', newEncryptedPrivateKey)
  // remove the default password from local storage
  localStorage.removeItem('nip49-default')
}

function loadEncryptedKey(): string|null {
  // check if a key exists in local storage
  const localEncryptedKey = localStorage.getItem('nip49');
  return localEncryptedKey
}

function createEncryptedKey() {
  if (localStorage.getItem('nip49')) {
    throw new Error('Key already exists in local storage')
  }
  // create a new private key and encrypt it with nip49 to store it locally
  const newSigner = NDKPrivateKeySigner.generate()
  const rawPrivateKeyBytes = hexToBytes(newSigner.privateKey as string)
  savePublicKey(rawPrivateKeyBytes)
  setRandomDefaultPassword(20)
  const password = localStorage.getItem('nip49-default') as string
  const nip49 = encrypt(rawPrivateKeyBytes, password, LOGN)
  localStorage.setItem('nip49', nip49)
  return newSigner
}

export function unlockKeyForSigning() {
  const encryptedPrivateKey = loadEncryptedKey()
  if (!encryptedPrivateKey) {
    console.warn('No encrypted private key found in local storage')
    // TODO - try a different signer method, like NIP-07, or trigger nostr-login?
    return
  }
  const defaultPassword = localStorage.getItem('nip49-default')
  let password
  if (!defaultPassword) {
    // user has set their own password
    password = prompt('Unlock your account with your password:')
  } else {
    password = defaultPassword
  }
  if (!password) {
    console.warn('No password provided to unlock key')
    return
  }
  const rawPrivateKeyBytes = decrypt(encryptedPrivateKey, password)
  const signer = new NDKPrivateKeySigner(rawPrivateKeyBytes)
  return signer
}