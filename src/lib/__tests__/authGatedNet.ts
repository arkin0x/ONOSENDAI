/**
 * authGatedNet.ts - a fake network for the tests of reads behind NIP-42 AUTH:
 * a canonical relay that gates reads, as cyberspace.nostr1.com did while it
 * was canonical (a challenge on every socket, and a REQ before AUTH closed
 * with "auth-required: you must auth"), or, with `openReads`, one that
 * challenges every socket and serves reads anyway, as relay.onosendai.tech
 * (grain) does since 2026-11-05; and a NIP-46
 * bunker on a relay of its own, answering over the same fake sockets with
 * real nip44 and real signatures. No socket leaves the process.
 *
 * The bunker is the owner's setup (a phone, a bunker signer): how long it
 * takes to answer an AUTH's sign_event, or whether it answers at all, is the
 * knob (`bunker.authDelay`, `bunker.refuseAuth`). Everything else it answers at once.
 */

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { nip19 } from 'nostr-tools'

/** The canonical relay's URL as the pool opens it (useRelays DEFAULT_RELAY). */
export const CANON = 'wss://relay.onosendai.tech/'
export const BUNKER_RELAY = 'wss://bunker.example/'
/** The pinned backup relay (useRelays SECOND_RELAY): with `gatedBackup`, it gates reads as it really does. */
export const BACKUP = 'wss://cyberspace.nostr1.com/'

type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
type F = Record<string, unknown>

function matches(f: F, e: Ev): boolean {
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false
  if (typeof f.since === 'number' && e.created_at < f.since) return false
  for (const [k, v] of Object.entries(f)) if (k.startsWith('#') && !e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]))) return false
  return true
}

export interface AuthGatedNet {
  /** The user's key: the bunker signs with it. */
  userSk: Uint8Array
  userPk: string
  /** What a page load with this bunker remembered stores as its signer preference. */
  pref: { kind: 'nip46'; pubkey: string; bunkerUri: string; clientNsec: string }
  /** Events the canonical relay holds and serves once a socket is authenticated. */
  hold: Ev[]
  bunker: {
    /** How long the bunker takes to answer an AUTH's sign_event: ms, or Infinity for never. */
    authDelay: number
    /** How many of the next AUTH sign_events the bunker refuses (a NIP-46 error answer), as a person tapping DENY. */
    refuseAuth: number
    /**
     * Per AUTH request, in order, overriding authDelay and refuseAuth while
     * it lasts: how long the bunker takes, and whether it then refuses.
     */
    authPlan: { delay: number; refuse?: boolean }[]
    /** Called on each AUTH request the bunker receives (an extension's popup opening). */
    onAuthAsked: (() => void) | null
    /**
     * Per connect request, in order: how long the bunker takes to answer it
     * (Infinity: the request is lost in transit, never answered), and
     * whether it then refuses ("unauthorized", a signer that does not know
     * this client). Once used up, connect is answered at once.
     */
    connectPlan: { delay: number; refuse?: boolean }[]
    /** connect requests the bunker received. */
    connects: number
    /** How long the bunker takes to answer get_public_key. */
    pubkeyDelay: number
    /** How many of the next sign_events of any kind the bunker refuses (DENY). */
    refuseSigns: number
    /** sign_event requests of any kind the bunker received. */
    signAsked: number
    /** sign_event requests for an AUTH the bunker received. */
    authAsked: number
    /** AUTHs it answered. */
    authSigned: number
  }
  canon: {
    /** REQs closed with auth-required. */
    refusedReqs: number
    /** AUTHs the relay accepted. */
    authOk: number
    /** Sockets opened to it. */
    sockets: number
    /** The pubkey of every AUTH the relay was sent, in order, accepted or not. */
    authBy: string[]
  }
  /** How many of the next connections to the canonical relay fail. */
  failConnects: number
  /** How long after a socket opens the canonical relay sends its challenge. */
  challengeDelay: number
  /** How long the canonical relay takes to answer an AUTH with OK. */
  authOkDelay: number
  /** The canonical relay turns every AUTH down (OK false), whoever signed it. */
  rejectAuth: boolean
  /** The canonical relay serves REQs before AUTH (it still sends its challenge), as grain does. */
  openReads: boolean
  /**
   * The backup relay is served too, gating reads as cyberspace.nostr1.com
   * does (a challenge on every socket, REQs refused until AUTH), from the
   * same events. Off, it is not on this network at all.
   */
  gatedBackup: boolean
  /** How long the canonical relay takes between one event of an answer and the next (a busy socket). */
  streamMs: number
  /** The canonical relay drops every open socket, as a phone does to a tab put away. */
  dropCanon(): void
  /**
   * Every socket open to the bunker's relay goes half-open, as a phone's do
   * while the tab is put away: they look open, and nothing sent or due on
   * them arrives. Sockets opened after are healthy.
   */
  halfOpenBunker(): void
  /** Sockets opened to the bunker's relay. */
  bunkerSockets: number
  /**
   * How long the bunker's relay takes to put a subscription in place (then
   * its EOSE): a relay that handles a REQ and the EVENT after it in either
   * order, so an answer sent meanwhile reaches nobody.
   */
  subscribeDelay: number
  /** Some kind:33330 bags, held by the canonical relay. */
  addBags(n: number): Ev[]
  /** Put the fake WebSocket in place (after noNetwork.ts put its own). */
  install(): void
}

export function authGatedNet(): AuthGatedNet {
  const userSk = generateSecretKey()
  const userPk = getPublicKey(userSk)
  const bunkerSk = generateSecretKey()
  const bunkerPk = getPublicKey(bunkerSk)
  const clientSk = generateSecretKey()
  const net: AuthGatedNet = {
    userSk,
    userPk,
    pref: { kind: 'nip46', pubkey: userPk, bunkerUri: `bunker://${bunkerPk}?relay=${encodeURIComponent(BUNKER_RELAY.replace(/\/$/, ''))}`, clientNsec: nip19.nsecEncode(clientSk) },
    hold: [],
    bunker: { authDelay: 0, refuseAuth: 0, authPlan: [], connectPlan: [], connects: 0, pubkeyDelay: 0, refuseSigns: 0, signAsked: 0, onAuthAsked: null, authAsked: 0, authSigned: 0 },
    canon: { refusedReqs: 0, authOk: 0, sockets: 0, authBy: [] },
    failConnects: 0,
    challengeDelay: 0,
    authOkDelay: 0,
    rejectAuth: false,
    openReads: false,
    gatedBackup: false,
    streamMs: 0,
    dropCanon() { for (const s of [...canonSockets]) s.drop() },
    halfOpenBunker() { for (const s of [...bunkerSockets]) s.halfOpen = true },
    bunkerSockets: 0,
    subscribeDelay: 0,
    addBags(n) {
      const made: Ev[] = []
      for (let i = 0; i < n; i++) {
        const sk = generateSecretKey()
        const d = i.toString(16).padStart(64, '0')
        made.push(finalizeEvent({ kind: 33330, created_at: 1_700_000_000 + i, tags: [['d', d], ['encrypted', 'aes-256-gcm', 'deadbeef'.repeat(8)]], content: '' }, sk) as unknown as Ev)
      }
      net.hold.push(...made)
      return made
    },
    install() { (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket },
  }

  /** Live subscriptions on the bunker relay, across its sockets. */
  const bunkerSubs = new Set<{ socket: FakeSocket; id: string; filters: F[] }>()
  const broadcast = (e: Ev): void => {
    for (const s of bunkerSubs) if (s.socket.readyState === 1 && !s.socket.halfOpen && s.filters.some((f) => matches(f, e))) s.socket.deliver(['EVENT', s.id, e])
  }

  /** The bunker: decrypts a request, answers it as the user, after its delay. */
  const answerBunker = (req: Ev): void => {
    const ck = nip44.v2.utils.getConversationKey(bunkerSk, req.pubkey)
    const { id, method, params } = JSON.parse(nip44.v2.decrypt(req.content, ck)) as { id: string; method: string; params: string[] }
    const reply = (result: string, error?: string): void => {
      const content = nip44.v2.encrypt(JSON.stringify(error ? { id, result: '', error } : { id, result }), ck)
      broadcast(finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', req.pubkey]], content }, bunkerSk) as unknown as Ev)
    }
    if (method === 'connect') {
      net.bunker.connects++
      const planned = net.bunker.connectPlan.shift()
      if (!planned) return reply('ack')
      if (!Number.isFinite(planned.delay)) return
      setTimeout(() => { if (planned.refuse) reply('', 'unauthorized'); else reply('ack') }, planned.delay)
      return
    }
    if (method === 'get_public_key') {
      if (net.bunker.pubkeyDelay > 0) { setTimeout(() => reply(userPk), net.bunker.pubkeyDelay); return }
      return reply(userPk)
    }
    if (method === 'ping') return reply('pong')
    if (method === 'sign_event') {
      const template = JSON.parse(params[0]) as { kind: number; created_at: number; tags: string[][]; content: string }
      const sign = (): void => reply(JSON.stringify(finalizeEvent(template, userSk)))
      net.bunker.signAsked++
      if (net.bunker.refuseSigns > 0) { net.bunker.refuseSigns--; return reply('', 'denied') }
      if (template.kind !== 22242) return sign()
      net.bunker.authAsked++
      net.bunker.onAuthAsked?.()
      const planned = net.bunker.authPlan.shift()
      if (planned) {
        setTimeout(() => { if (planned.refuse) reply('', 'denied'); else { net.bunker.authSigned++; sign() } }, planned.delay)
        return
      }
      if (net.bunker.refuseAuth > 0) { net.bunker.refuseAuth--; return reply('', 'denied') }
      const d = net.bunker.authDelay
      if (!Number.isFinite(d)) return
      setTimeout(() => { net.bunker.authSigned++; sign() }, d)
    }
  }

  let challenges = 0
  const canonSockets = new Set<FakeSocket>()
  const bunkerSockets = new Set<FakeSocket>()
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    url: string
    challenge = ''
    /** Every challenge this socket was sent; an AUTH answering any of them signs in. */
    challenges: string[] = []
    authed = false
    /** Looks open; nothing sent on it or due over it arrives (halfOpenBunker). */
    halfOpen = false
    onopen?: (() => void) | null
    onclose?: ((e: { code: number; reason: string }) => void) | null
    onmessage?: ((e: { data: string }) => void) | null
    onerror?: ((e: unknown) => void) | null
    constructor(url: string | URL) {
      this.url = String(url)
      const backup = net.gatedBackup && this.url === BACKUP
      if (this.url !== CANON && this.url !== BUNKER_RELAY && !backup) throw new Error(`authGatedNet: no relay at ${this.url}`)
      if (this.url === CANON) net.canon.sockets++
      if (this.url === CANON && net.failConnects > 0) {
        net.failConnects--
        setTimeout(() => { this.readyState = 3; this.onerror?.(new Error('connection refused')); this.onclose?.({ code: 1006, reason: '' }) }, 5)
        return
      }
      if (this.url === CANON || backup) canonSockets.add(this)
      else { bunkerSockets.add(this); net.bunkerSockets++ }
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.()
        if (this.url === CANON || backup) {
          this.challenge = `c${++challenges}`
          this.challenges.push(this.challenge)
          const send = (): void => this.deliver(['AUTH', this.challenge])
          if (net.challengeDelay > 0) setTimeout(send, net.challengeDelay)
          else send()
        }
      }, 5)
    }
    deliver(msg: unknown[]): void {
      if (this.readyState === 1 && !this.halfOpen) this.onmessage?.({ data: JSON.stringify(msg) })
    }
    send(raw: string): void {
      const msg = JSON.parse(raw) as unknown[]
      setTimeout(() => {
        if (this.readyState !== 1 || this.halfOpen) return
        if (this.url === CANON || this.url === BACKUP) this.canonical(msg)
        else this.bunkerRelay(msg)
      }, 1)
    }
    private canonical(msg: unknown[]): void {
      if (msg[0] === 'AUTH') {
        const e = msg[1] as Ev
        net.canon.authBy.push(e.pubkey)
        const ok = !net.rejectAuth && verifyEvent(e as never) && e.kind === 22242 && e.tags.some((t) => t[0] === 'challenge' && this.challenges.includes(t[1]))
        const answer = (): void => {
          if (ok) { this.authed = true; net.canon.authOk++ }
          this.deliver(['OK', e.id, ok, ok ? '' : 'auth-required: bad auth'])
        }
        if (net.authOkDelay > 0) setTimeout(answer, net.authOkDelay)
        else answer()
        return
      }
      if (msg[0] === 'REQ') {
        const id = msg[1] as string
        if (!this.authed && !(net.openReads && this.url === CANON)) {
          // As the real relay does (probed 2026-11-04): a fresh challenge with the refusal. Either still signs in.
          net.canon.refusedReqs++
          this.challenges.push(`c${++challenges}`)
          this.deliver(['AUTH', this.challenges[this.challenges.length - 1]])
          this.deliver(['CLOSED', id, 'auth-required: you must auth'])
          return
        }
        const out = (msg.slice(2) as F[]).flatMap((f) => net.hold.filter((e) => matches(f, e)))
        if (net.streamMs <= 0) {
          for (const e of out) this.deliver(['EVENT', id, e])
          this.deliver(['EOSE', id])
          return
        }
        let i = 0
        const next = (): void => {
          if (this.readyState !== 1) return
          if (i < out.length) { this.deliver(['EVENT', id, out[i++]]); setTimeout(next, net.streamMs); return }
          this.deliver(['EOSE', id])
        }
        next()
        return
      }
      if (msg[0] === 'EVENT') this.deliver(['OK', (msg[1] as Ev).id, true, ''])
    }
    private bunkerRelay(msg: unknown[]): void {
      if (msg[0] === 'REQ') {
        const add = (): void => {
          bunkerSubs.add({ socket: this, id: msg[1] as string, filters: msg.slice(2) as F[] })
          this.deliver(['EOSE', msg[1]])
        }
        if (net.subscribeDelay > 0) setTimeout(add, net.subscribeDelay)
        else add()
        return
      }
      if (msg[0] === 'CLOSE') { for (const s of bunkerSubs) if (s.socket === this && s.id === msg[1]) bunkerSubs.delete(s); return }
      if (msg[0] === 'EVENT') {
        const e = msg[1] as Ev
        this.deliver(['OK', e.id, true, ''])
        if (e.kind === 24133 && e.tags.some((t) => t[0] === 'p' && t[1] === bunkerPk)) answerBunker(e)
      }
    }
    /** The far end goes away. */
    drop(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      canonSockets.delete(this)
      bunkerSockets.delete(this)
      this.onclose?.({ code: 1006, reason: '' })
    }
    close(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      canonSockets.delete(this)
      bunkerSockets.delete(this)
      for (const s of bunkerSubs) if (s.socket === this) bunkerSubs.delete(s)
      setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0)
    }
  }
  return net
}
