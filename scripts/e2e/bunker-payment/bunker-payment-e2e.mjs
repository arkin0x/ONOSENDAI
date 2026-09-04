// End to end: a bunker-signed HOSAKA payment recognised after the phone's app switch.
// Needs: nak serve on 10547, halfopen-proxy.mjs 10548->10547 (control 10549), fake-bunker.mjs
// on the relay directly, a dev server. usage: node bunker-payment-e2e.mjs <port> <label> <keys.json> <bunkerlog>
import fs from 'node:fs'
import { chromium } from 'playwright'
import { getPublicKey, generateSecretKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { hexToBytes } from '@noble/hashes/utils'

const PORT = +process.argv[2] || 5211
const LABEL = process.argv[3] || 'run'
const keys = JSON.parse(fs.readFileSync(process.argv[4] || 'bunker-keys.json', 'utf8'))
const BUNKER_LOG = process.argv[5] || 'fake-bunker.log'
const bunkerPub = getPublicKey(hexToBytes(keys.bunkerSk)), userPub = getPublicKey(hexToBytes(keys.userSk))
const RELAY_VIA_PROXY = 'ws://127.0.0.1:10548'
const bunkerUri = `bunker://${bunkerPub}?relay=${encodeURIComponent(RELAY_VIA_PROXY)}`
const clientSk = generateSecretKey()
const pref = { kind: 'nip46', pubkey: userPub, bunkerUri, clientNsec: nsecEncode(clientSk) }
const control = (path) => fetch(`http://127.0.0.1:10549${path}`).then((r) => r.text())
const bunkerLines = () => fs.existsSync(BUNKER_LOG) ? fs.readFileSync(BUNKER_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []

const API = `http://127.0.0.1:${PORT}/hosaka-stub`
let paid = false, claims = 0, deposits = 0
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.addInitScript((p) => { try { localStorage.setItem('onosendai:signer', JSON.stringify(p)); localStorage.removeItem('onosendai:cloudDeposit'); localStorage.removeItem('onosendai:cloudJob') } catch {} }, pref)
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
const deposit = () => ({ deposit_id: 'dep-1', status: paid ? 'settled' : 'pending', amount_msats: 10000, bolt11: 'lnbc100n1fake', payment_hash: 'ff'.repeat(32), created_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 3600, settled_at: paid ? Math.floor(Date.now() / 1000) : null, settled_msats: paid ? 10000 : null, balance_msats: paid ? 10000 : 0 })
await page.route('**/hosaka-stub/**', async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname.replace(/^.*\/hosaka-stub/, '')
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  if (p === '/api/v1/limits') return json(route, { max_hop_height: 27, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600 })
  if (p === '/api/v1/balance') return json(route, { pubkey: userPub, balance_msats: paid ? 10000 : 0, ledger: [] })
  if (p === '/api/v1/quote') { const b = JSON.parse(req.postData()); return json(route, { action: b.action, cost_msats: 10000, within_cap: true, cap: 27, max_height: 24, per_axis_heights: { x: 24, y: 0, z: 0 }, K: 7, tier: 'small', est_seconds: 277, est_time: 'about 5 min', hint: null }) }
  if (p === '/api/v1/deposit' && req.method() === 'POST') { deposits++; return json(route, deposit(), 201) }
  if (/^\/api\/v1\/deposit\/dep-1\/claim$/.test(p)) { claims++; return json(route, deposit()) }
  if (p === '/api/v1/deposit/dep-1') return json(route, deposit())
  if (p === '/api/v1/hop') return json(route, { id: 'job-1', status: 'computing', cost_msats: 10000, poll_token: 'tok', result: null, error: null, payment_required: false, balance_debited: true })
  if (p.startsWith('/api/v1/jobs/')) return json(route, { id: 'job-1', status: 'computing', cost_msats: 10000, result: { progress_percent: 10 }, error: null })
  return json(route, { error: 'unstubbed ' + p }, 404)
})

const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1)
const state = () => page.evaluate(() => { const s = window.__store.getState(); return { signer: s.signerKind, me: s.identity.pubkey.slice(0, 8), loginError: s.loginError, cloud: s.cloud.status, checking: s.cloud.checking, msg: (s.cloud.message || '').slice(0, 70), proof: s.proof.status, pmsg: (s.proof.message || '').slice(0, 70) } })
await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'load' })
// Wait for the bunker identity to take over (initSigner connects through the proxy).
for (let i = 0; i < 40; i++) { const s = await state(); if (s.signer === 'nip46' && s.me === userPub.slice(0, 8)) break; await page.waitForTimeout(500) }
console.log(t(), 'signer', JSON.stringify(await state()))
await page.evaluate((api) => { window.__store.setState({ cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: api } }) }, API)
await page.waitForTimeout(8000) // let calibration and caps settle before committing (#69)
// An h24 crossing on x: beyond this machine, HOSAKA's job.
await page.evaluate(() => { const st = window.__store; const s = st.getState(); st.setState({ cursor: { ...s.position, x: s.position.x ^ (1n << 23n) } }); void st.getState().commit() })
for (let i = 0; i < 60; i++) { const s = await state(); if (s.cloud === 'awaiting_payment') break; await page.waitForTimeout(500) }
console.log(t(), 'after commit', JSON.stringify(await state()), 'deposits', deposits, 'claims', claims)
const signsBefore = bunkerLines().filter((l) => l.method === 'sign_event').length

// The app switch: the tab goes hidden, and every socket it holds goes half-open.
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
console.log(t(), 'hidden; proxy ->', await control('/dead'))
await page.waitForTimeout(12000) // in the wallet
paid = true
console.log(t(), 'PAID in the wallet; coming back')
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
const tBack = Date.now()
let recognised = null
for (let i = 0; i < 180; i++) {
  const s = await state()
  if (s.cloud === 'paid' || s.cloud === 'computing') { recognised = (Date.now() - tBack) / 1000; console.log(t(), 'RECOGNISED after', recognised.toFixed(1), 's', JSON.stringify(s)); break }
  if (s.cloud === 'error') { console.log(t(), 'FLOW DIED', JSON.stringify(s)); break }
  if (i % 10 === 9) console.log(t(), 'still waiting', JSON.stringify(s), 'claims', claims, 'signs', bunkerLines().filter((l) => l.method === 'sign_event').length - signsBefore)
  await page.waitForTimeout(500)
}
const signsAfter = bunkerLines().filter((l) => l.method === 'sign_event').length - signsBefore
console.log(JSON.stringify({ label: LABEL, recognisedAfterSeconds: recognised, claimsTotal: claims, signRequestsAfterReturn: signsAfter, proxy: await control('/status'), final: await state() }))
await browser.close()
