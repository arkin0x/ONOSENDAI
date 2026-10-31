/**
 * Cards share one canvas (scene/CardSpin): a WebGL context per opened card froze
 * the page for 6 to 20 s under SwiftShader, and made and threw away a context
 * each time, the churn behind TV's freeze (#394).
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { topClaim, useSpinStack } from '../cardSpinStack'
import { CARD_SPIN_FRAME_MS } from '../CardSpin'
import type { ShardModel } from 'sno-core/shards'

const SRC = path.resolve(__dirname, '../..')
const slot = (): HTMLElement => ({}) as HTMLElement
const shard = (id: string): ShardModel => ({ id }) as unknown as ShardModel

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__') sources(p, out) }
    else if (e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('one canvas for every card', () => {
  it('only CardSpin and TV\'s one host draw a ShardSpin: a card never makes a context of its own', () => {
    const users = sources(SRC)
      .filter((f) => /<ShardSpin\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).replaceAll(path.sep, '/'))
      .sort()
    expect(users).toEqual(['hud/TvSegments.tsx', 'scene/CardSpin.tsx'])
  })

  it('nothing new under cards makes a Canvas of its own', () => {
    for (const f of ['hud/PersonModal.tsx', 'hud/SecretModal.tsx']) {
      const text = fs.readFileSync(path.join(SRC, f), 'utf8')
      expect(text).toMatch(/CardSpin/)
      expect(text).not.toMatch(/<Canvas\b/)
    }
  })

  it('the host is drawn on demand at about 30 frames a second, not at the display\'s rate', () => {
    const text = fs.readFileSync(path.join(SRC, 'scene/CardSpin.tsx'), 'utf8')
    expect(text).toMatch(/pace=\{pace\}/)
    expect(CARD_SPIN_FRAME_MS).toBeGreaterThanOrEqual(1000 / 40)
  })
})

describe('who holds it', () => {
  beforeEach(() => useSpinStack.setState({ claims: [] }))
  const stack = (): ReturnType<typeof useSpinStack.getState> => useSpinStack.getState()

  it('nobody, at first', () => {
    expect(topClaim(stack().claims)).toBeNull()
  })

  it('the card opened last, and back to the one under it when that closes', () => {
    const a = stack().claim({ shard: shard('a'), size: 160, ignoreOpacity: false, slot: slot() })
    const b = stack().claim({ shard: shard('b'), size: 160, ignoreOpacity: true, slot: slot() })
    expect(topClaim(stack().claims)?.id).toBe(b)
    stack().release(b)
    expect(topClaim(stack().claims)?.id).toBe(a)
    stack().release(a)
    expect(topClaim(stack().claims)).toBeNull()
  })

  it('a card under another closing first leaves the top alone', () => {
    const a = stack().claim({ shard: shard('a'), size: 160, ignoreOpacity: false, slot: slot() })
    const b = stack().claim({ shard: shard('b'), size: 160, ignoreOpacity: false, slot: slot() })
    stack().release(a)
    expect(topClaim(stack().claims)?.id).toBe(b)
  })

  it('a new shard in the same card updates its claim', () => {
    const a = stack().claim({ shard: shard('a'), size: 160, ignoreOpacity: false, slot: slot() })
    stack().update(a, { shard: shard('c') })
    expect(topClaim(stack().claims)?.shard?.id).toBe('c')
  })
})
