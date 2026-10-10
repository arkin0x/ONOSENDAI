/**
 * agentInvite.test.ts: the invitation carries what ruling 3 says (the guide,
 * the install line, the operator's npub, the rendezvous, a one-time code, a
 * budget) and nothing it must not (no key, no funds), and MY AGENTS keeps
 * only the profiles that are bots naming the operator.
 */
import { describe, expect, it } from 'vitest'
import {
  AGENTS_MD_URL, CODE_SHAPE, CODE_WORDS, SUGGESTED_BUDGET,
  agentsOf, invitationText, isBotProfile, isOperatorTag, meetingCode, namesOperator,
} from '../agentInvite'

const npub = 'npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w'
const coord = '0123456789abcdef'.repeat(4)
const me = 'ab'.repeat(32)
const other = 'cd'.repeat(32)

/** A random source that hands out the given bytes in order, then zeros. */
function scripted(...bytes: number[]): (b: Uint8Array) => Uint8Array {
  const queue = [...bytes]
  return (b) => { for (let i = 0; i < b.length; i++) b[i] = queue.shift() ?? 0; return b }
}

describe('the meeting code', () => {
  it('is one of sixty-four distinct words, a dash, and four digits', () => {
    expect(CODE_WORDS).toHaveLength(64)
    expect(new Set(CODE_WORDS).size).toBe(64)
    for (let i = 0; i < 50; i++) {
      const code = meetingCode()
      expect(code).toMatch(CODE_SHAPE)
      expect(CODE_WORDS).toContain(code.split('-')[0])
    }
  })

  it('takes the word from six bits and skips bytes that would bias a digit', () => {
    expect(meetingCode(scripted(0, 0, 0, 0, 0))).toBe('ANCHOR-0000')
    // 65 & 63 = 1 (BASALT); 255 and 250 are skipped, then 1 2 3 4 are taken modulo ten.
    expect(meetingCode(scripted(65, 255, 250, 11, 2, 13, 4))).toBe('BASALT-1234')
  })
})

describe('the invitation', () => {
  const code = 'CANTOR-4821'
  const text = invitationText({ npub, coordinateHex: coord, code })

  it('carries the guide, the install line, the npub, the rendezvous, the code and the budget', () => {
    expect(text).toContain(AGENTS_MD_URL)
    expect(text).toContain(`claude mcp add cyberspace -- node /path/to/cyberspace-mcp/dist/bin.js --state ~/cyberspace-agent --operator ${npub}`)
    expect(text).toContain(`OPERATOR\n  ${npub}`)
    expect(text).toContain(`RENDEZVOUS\n  ${coord}`)
    expect(text).toContain(`MEETING CODE\n  ${code}`)
    expect(text).toContain(SUGGESTED_BUDGET)
    // The agent should put the code in the message it hides at the rendezvous.
    expect(text).toContain(`"${code}. Left for ${npub}`)
    // Reading needs no travel, and the agent must not try to hop there.
    expect(text).toMatch(/need no travel/)
    expect(text).toMatch(/Never pass --allow-respawn/)
  })

  it('carries no key, no funds, and no hex but the rendezvous', () => {
    expect(text).not.toMatch(/nsec1/)
    expect(text).not.toMatch(/cashu|sats|token/i)
    expect(text).not.toMatch(/--allow-respawn\s*$/m)
    const hexes = text.match(/[0-9a-f]{64}/g) ?? []
    expect(hexes.length).toBeGreaterThan(0)
    expect(new Set(hexes)).toEqual(new Set([coord]))
    // The file named key is mentioned only to forbid reading it.
    expect(text).toMatch(/never read or print the file named key/)
    expect(text).not.toMatch(/[\u2013\u2014]/)
  })

  it('reads the same in a terminal: plain text, no markdown', () => {
    expect(text).not.toMatch(/^#|\*\*|`/m)
  })
})

describe('the operator tag', () => {
  it('is a p tag naming the operator with operator in the last place', () => {
    expect(isOperatorTag(['p', me, '', 'operator'], me)).toBe(true)
    expect(isOperatorTag(['p', me, 'wss://relay.example', 'operator'], me)).toBe(true)
    expect(isOperatorTag(['p', me, 'operator'], me)).toBe(true)
    expect(isOperatorTag(['p', me], me)).toBe(false)
    expect(isOperatorTag(['p', me, '', 'mention'], me)).toBe(false)
    expect(isOperatorTag(['p', other, '', 'operator'], me)).toBe(false)
    expect(isOperatorTag(['e', me, '', 'operator'], me)).toBe(false)
  })

  it('needs bot: true in the content, exactly', () => {
    expect(isBotProfile('{"name":"x","bot":true}')).toBe(true)
    expect(isBotProfile('{"bot":"true"}')).toBe(false)
    expect(isBotProfile('{"bot":1}')).toBe(false)
    expect(isBotProfile('{}')).toBe(false)
    expect(isBotProfile('not json')).toBe(false)
    expect(isBotProfile('null')).toBe(false)
  })

  it('names the operator only when both the tag and the flag are there', () => {
    const tagged = { kind: 0, tags: [['p', me, '', 'operator']], content: '{"bot":true}' }
    expect(namesOperator(tagged, me)).toBe(true)
    expect(namesOperator({ ...tagged, content: '{"bot":false}' }, me)).toBe(false)
    expect(namesOperator({ ...tagged, tags: [['p', me]] }, me)).toBe(false)
    expect(namesOperator({ ...tagged, kind: 1 }, me)).toBe(false)
    expect(namesOperator(tagged, other)).toBe(false)
  })
})

describe('agentsOf', () => {
  const ev = (id: string, pubkey: string, at: number, extra: Partial<{ tags: string[][]; content: string }> = {}) => ({
    id, pubkey, kind: 0, created_at: at, tags: [['p', me, '', 'operator']], content: '{"bot":true}', ...extra,
  })
  const a = 'a1'.repeat(32)
  const b = 'b2'.repeat(32)

  it('lists each agent once, newest profile first, and drops what does not qualify', () => {
    const list = agentsOf([
      ev('1', a, 100),
      ev('2', a, 200),
      ev('3', b, 150),
      ev('4', other, 300, { content: '{}' }),
      ev('5', other, 300, { tags: [['p', me]] }),
    ], me)
    expect(list).toEqual([a, b])
  })

  it('breaks a same-second tie by the lowest id, as NIP-01 does', () => {
    expect(agentsOf([ev('f', a, 100), ev('e', b, 100)], me)).toEqual([b, a])
  })

  it('leaves out an agent whose cached profile is newer than anything the query returned', () => {
    // A later kind 0 exists that the #p query did not return: it dropped the tag.
    const cached = (pk: string): number | undefined => (pk === a ? 250 : undefined)
    expect(agentsOf([ev('1', a, 200), ev('2', b, 150)], me, cached)).toEqual([b])
    // The same second is the same profile, so it stays.
    expect(agentsOf([ev('1', a, 200)], me, () => 200)).toEqual([a])
  })
})
