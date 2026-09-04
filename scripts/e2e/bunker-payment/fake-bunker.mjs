// A NIP-46 remote signer over the local relay: answers connect, get_public_key,
// sign_event and ping for one user key. Logs every request as JSON lines to
// the file in argv[3] so a test can see when the client's requests arrive.
import fs from 'node:fs'
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils'

const RELAY = process.argv[2] || 'ws://127.0.0.1:10548'
const LOG = process.argv[3] || 'fake-bunker.log'
const KEYS = process.argv[4] // optional path to persisted keys
let bunkerSk, userSk
if (KEYS && fs.existsSync(KEYS)) { const k = JSON.parse(fs.readFileSync(KEYS, 'utf8')); bunkerSk = hexToBytes(k.bunkerSk); userSk = hexToBytes(k.userSk) }
else { bunkerSk = generateSecretKey(); userSk = generateSecretKey(); if (KEYS) fs.writeFileSync(KEYS, JSON.stringify({ bunkerSk: bytesToHex(bunkerSk), userSk: bytesToHex(userSk) })) }
const bunkerPub = getPublicKey(bunkerSk), userPub = getPublicKey(userSk)
console.log(JSON.stringify({ bunkerPub, userPub, bunkerUri: `bunker://${bunkerPub}?relay=${encodeURIComponent(RELAY)}` }))

const pool = new SimplePool()
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n')
pool.subscribe([RELAY], { kinds: [24133], '#p': [bunkerPub] }, {
  onevent: async (ev) => {
    const convKey = nip44.v2.utils.getConversationKey(bunkerSk, ev.pubkey)
    let req
    try { req = JSON.parse(nip44.v2.decrypt(ev.content, convKey)) } catch (e) { log({ bad: String(e) }); return }
    let result = null, error = null
    try {
      if (req.method === 'connect') result = 'ack'
      else if (req.method === 'get_public_key') result = userPub
      else if (req.method === 'ping') result = 'pong'
      else if (req.method === 'sign_event') { const t = JSON.parse(req.params[0]); result = JSON.stringify(finalizeEvent(t, userSk)) }
      else error = `unsupported ${req.method}`
    } catch (e) { error = String(e) }
    const kind = req.method === 'sign_event' ? JSON.parse(req.params[0]).kind : undefined
    log({ method: req.method, id: req.id, kind, from: ev.pubkey.slice(0, 8) })
    const reply = finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', ev.pubkey]], content: nip44.v2.encrypt(JSON.stringify({ id: req.id, result, error }), convKey) }, bunkerSk)
    try { await Promise.any(pool.publish([RELAY], reply)) } catch (e) { log({ publishFailed: String(e) }) }
  },
  oneose: () => log({ ready: true }),
})
