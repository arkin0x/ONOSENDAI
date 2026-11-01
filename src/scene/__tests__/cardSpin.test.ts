/**
 * Cards share one canvas (scene/CardSpin): a WebGL context per opened card froze
 * the page for 6 to 20 s under SwiftShader, and made and threw away a context
 * each time, the churn behind TV's freeze (#394).
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { topClaim, useSpinStack } from '../cardSpinStack'
import { CARD_SPIN_FRAME_MS, CONTEXT_BACK_MS, moveHost, needsRemake } from '../CardSpin'
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
      expect(text).not.toMatch(/<Canvas\b/)
    }
  })

  it('both cards really use it: not a comment, and not ShardSpin as a default (review of #560)', () => {
    const person = fs.readFileSync(path.join(SRC, 'hud/PersonModal.tsx'), 'utf8')
    expect(person).toMatch(/Preview = CardSpin\b/)
    expect(person).not.toMatch(/\bShardSpin\b/)
    const secret = fs.readFileSync(path.join(SRC, 'hud/SecretModal.tsx'), 'utf8')
    expect(secret).toMatch(/<CardSpin shard=/)
    expect(secret).not.toMatch(/\bShardSpin\b/)
  })

  it('the host is drawn on demand at about 30 frames a second, not at the display\'s rate', () => {
    const text = fs.readFileSync(path.join(SRC, 'scene/CardSpin.tsx'), 'utf8')
    expect(text).toMatch(/pace=\{pace\}/)
    expect(CARD_SPIN_FRAME_MS).toBeGreaterThanOrEqual(1000 / 40)
  })
})

describe('moving the canvas', () => {
  // The repo has no DOM for tests, so these are the two calls that matter, on fakes.
  const fake = (): { parentElement: unknown; style: { visibility: string }; moved: unknown[]; append(c: unknown): void } => {
    const f = { parentElement: null as unknown, style: { visibility: 'visible' }, moved: [] as unknown[], append(c: unknown) { f.moved.push(c) } }
    return f
  }

  it('goes to the card on top, hidden until it has drawn there', () => {
    const host = fake(), slot = fake(), park = fake()
    moveHost(host, { slot: slot as unknown as HTMLElement }, park)
    expect(slot.moved).toEqual([host])
    expect(host.style.visibility).toBe('hidden')
    expect(park.moved).toEqual([])
  })

  it('goes back to its parking when no card holds it', () => {
    const host = fake(), park = fake()
    moveHost(host, null, park)
    expect(park.moved).toEqual([host])
  })

  it('stays put when it is already there, and is not hidden again', () => {
    const slot = fake(), host = { ...fake(), parentElement: slot }
    moveHost(host, { slot: slot as unknown as HTMLElement }, fake())
    expect(slot.moved).toEqual([])
    expect(host.style.visibility).toBe('visible')
  })
})

describe('a canvas that fails is made again (review of #560)', () => {
  const live = { isContextLost: () => false }
  const gone = { isContextLost: () => true }

  it('at the next card, if it threw or its context is gone', () => {
    expect(needsRemake(true, null)).toBe(true)
    expect(needsRemake(false, gone)).toBe(true)
    expect(needsRemake(false, live)).toBe(false)
    expect(needsRemake(false, null)).toBe(false)
  })

  it('a new making number is what remakes it, and a claim survives it', () => {
    useSpinStack.setState({ claims: [], made: 0 })
    const a = useSpinStack.getState().claim({ shard: shard('a'), size: 160, ignoreOpacity: false, slot: slot() })
    useSpinStack.getState().remake()
    expect(useSpinStack.getState().made).toBe(1)
    expect(topClaim(useSpinStack.getState().claims)?.id).toBe(a)
  })

  it('the host is under a boundary keyed on that number, and is watched', () => {
    const text = fs.readFileSync(path.join(SRC, 'scene/CardSpin.tsx'), 'utf8')
    expect(text).toMatch(/<HostBoundary key=\{made\}><Host \/><\/HostBoundary>/)
    expect(text).toMatch(/watchContext\(canvas, 'cards'\)/)
    expect(text).toMatch(/needsRemake\(broken, context\)/)
    expect(CONTEXT_BACK_MS).toBeGreaterThanOrEqual(1000)
  })

  it('with a coarse pointer the canvas goes after the same wait as the pictures\' stage', () => {
    const text = fs.readFileSync(path.join(SRC, 'scene/CardSpin.tsx'), 'utf8')
    expect(text).toMatch(/\(pointer: fine\)/)
    expect(text).toMatch(/setUp\(false\), stageIdleMs\(false\)/)
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
