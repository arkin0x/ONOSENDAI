/**
 * A long chain's signatures are checked off the main thread (lib/relay query
 * offThread, lib/sigCheck keepAuthentic): checked as they landed, one chain took
 * about 2 s of main thread. Nothing unchecked may reach whoever asked, and no
 * other subscription's event may skip its check. Real keys and signatures; no relay.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, type NostrEvent } from 'nostr-tools/pure'
import { WORKER_FROM, keepAuthentic, keepAuthenticAnswers, sigHolds } from '../sigCheck'
import { alreadyChecked, checkedElsewhere, deferCheck, verifyOnce, verifyUnlessDeferred } from '../verifiedSigs'

const key = generateSecretKey()
const event = (n: number): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1000 + n, tags: [], content: `hop ${n}` }, key) as unknown as NostrEvent
// Through JSON, as a relay hands it over: a spread would keep nostr-tools' mark that it has been verified.
const wire = (e: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(e)) as NostrEvent
const forged = (n: number): NostrEvent => ({ ...wire(event(n)), sig: 'f'.repeat(128) })
const tampered = (n: number): NostrEvent => ({ ...wire(event(n)), content: 'something else' })

describe('a deferred check (review the threat here: a skipped signature)', () => {
  it('skips only the event in hand, once', () => {
    const bad = forged(1)
    deferCheck(bad.id)
    expect(verifyUnlessDeferred(bad)).toBe(true)
    expect(verifyUnlessDeferred({ ...bad })).toBe(false)
  })

  it('does not reach another event', () => {
    const a = forged(2), b = forged(3)
    deferCheck(a.id)
    expect(verifyUnlessDeferred(b)).toBe(false)
  })

  it('does not outlive the frame: a repeat that returned early leaves nothing for the next frame', async () => {
    const bad = forged(4)
    // The pool answered "already have it", so verifyEvent was never asked for this frame.
    deferCheck(bad.id)
    await Promise.resolve()
    // The next frame, another subscription, the same id with a forged signature.
    expect(verifyUnlessDeferred(bad)).toBe(false)
  })

  it('says it is not a repeat, so the event goes on to be handled', () => {
    expect(deferCheck(event(5).id)).toBe(false)
  })

  it('with nothing deferred, it is verifyOnce', () => {
    expect(verifyUnlessDeferred(wire(event(6)))).toBe(true)
    expect(verifyUnlessDeferred(forged(7))).toBe(false)
  })
})

describe('keeping what is authentic', () => {
  it('a short answer: each checked here, the forged and the tampered dropped', async () => {
    const good = wire(event(10)), f = forged(11), t = tampered(12)
    expect(await keepAuthentic([good, f, t])).toEqual([good])
  })

  it('a long answer: the same, however many there are', async () => {
    const good = Array.from({ length: WORKER_FROM + 8 }, (_, i) => wire(event(100 + i)))
    const f = forged(200), t = tampered(201)
    const kept = await keepAuthentic([f, ...good, t])
    expect(kept.map((e) => e.id).sort()).toEqual(good.map((e) => e.id).sort())
  })

  it('a long answer leaves its signatures remembered, so a repeat view is free', async () => {
    const events = Array.from({ length: WORKER_FROM + 2 }, (_, i) => wire(event(300 + i)))
    await keepAuthentic(events)
    expect(alreadyChecked(events.map(wire)).length).toBe(events.length)
  })

  it('a remembered signature does not vouch for changed contents: the id is recomputed', () => {
    const e = wire(event(400))
    expect(verifyOnce(e)).toBe(true)
    const known = new Set(alreadyChecked([e]))
    expect(sigHolds(wire(e), known)).toBe(true)
    // Same id and sig, other contents.
    expect(sigHolds({ ...wire(e), content: 'changed' }, known)).toBe(false)
    expect(sigHolds({ ...wire(e), pubkey: 'a'.repeat(64) }, known)).toBe(false)
  })

  it('a remembered signature does not vouch for another signature on the same id', () => {
    const e = wire(event(401))
    verifyOnce(e)
    expect(sigHolds({ ...wire(e), sig: 'f'.repeat(128) }, new Set(alreadyChecked([e])))).toBe(false)
  })

  it('what comes back good is marked, as the pool would have', () => {
    const e = wire(event(402))
    checkedElsewhere(e)
    expect(Object.getOwnPropertySymbols(e).length).toBe(1)
  })
})

describe('more than one relay', () => {
  it('a forged copy from one relay does not hide the real event from another', async () => {
    const real = event(500)
    const answers = await keepAuthenticAnswers([
      { url: 'a', events: [{ ...wire(real), sig: 'f'.repeat(128) }] },
      { url: 'b', events: [wire(real)] },
    ])
    expect(answers[0].events).toEqual([])
    expect(answers[1].events.map((e) => e.id)).toEqual([real.id])
  })

  it('a later relay\'s copies of what an earlier one proved are not checked again', async () => {
    const events = Array.from({ length: WORKER_FROM }, (_, i) => wire(event(600 + i)))
    await keepAuthenticAnswers([{ url: 'a', events }])
    expect(alreadyChecked(events.map(wire)).length).toBe(events.length)
  })
})

describe('where it is used', () => {
  const SRC = path.resolve(__dirname, '../..')
  it('only a whole chain\'s fetch skips the check as events land', () => {
    const relay = fs.readFileSync(path.join(SRC, 'lib/relay.ts'), 'utf8')
    expect(relay.match(/alreadyHaveEvent: deferCheck/g)).toHaveLength(1)
    expect(relay.match(/deferChecks: true/g)).toHaveLength(1)
    expect(relay).toMatch(/return mergeAnswers\(await keepAuthenticAnswers\(await queryRelays\(relaySet\(\), filter, MAX_WAIT_MS, \{ deferChecks: true \}\)\)\)/)
    const chains = fs.readFileSync(path.join(SRC, 'lib/chains.ts'), 'utf8')
    expect(chains).toMatch(/gatherChain\(\(f\) => query\(f, \{ offThread: true \}\)/)
    expect(chains.match(/offThread: true/g)).toHaveLength(1)
  })
  it('the pool checks everything else as it lands', () => {
    const relay = fs.readFileSync(path.join(SRC, 'lib/relay.ts'), 'utf8')
    expect(relay).toMatch(/verifyEvent: \(ev\) => \(ev\.kind === 321 \? true : verifyUnlessDeferred\(ev\)\)/)
  })
  it('the frame still goes alreadyHaveEvent then verifyEvent, in one stack, in this nostr-tools', () => {
    const relay = fs.readFileSync(path.resolve(SRC, '../node_modules/nostr-tools/lib/esm/abstract-relay.js'), 'utf8')
    const at = relay.indexOf('_onmessage(ev) {')
    const body = relay.slice(at, relay.indexOf('case "COUNT"', at))
    expect(body.indexOf('so.alreadyHaveEvent?.(id)')).toBeGreaterThan(0)
    expect(body.indexOf('this.verifyEvent(event, this.url)')).toBeGreaterThan(body.indexOf('so.alreadyHaveEvent?.(id)'))
    expect(body.slice(body.indexOf('so.alreadyHaveEvent?.(id)'), body.indexOf('this.verifyEvent(event, this.url)'))).not.toMatch(/await|setTimeout|then\(/)
  })
})

