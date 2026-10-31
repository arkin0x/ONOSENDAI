/**
 * versionChip.test.tsx - what the instrument stack shows for a newer deploy
 * (hud/VersionChip.tsx, lib/versionGate.ts): a required one is the red bar
 * with one RELOAD; a hint is a small chip a tap dismisses; nothing else
 * shows anything.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VersionChipView } from '../VersionChip'
import { resetVersionGateForTests, useVersionGate, type Verdict } from '../../lib/versionGate'
import { setBroadcastForTest } from '../../lib/tv/broadcast'

const html = (verdict: Verdict, build: string | null = 'newer', dismissed: string | null = null): string =>
  renderToStaticMarkup(<VersionChipView verdict={verdict} build={build} dismissed={dismissed} />)
const buttons = (h: string): string[] => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

afterEach(() => { resetVersionGateForTests(false); setBroadcastForTest(null) })

describe('the version chip', () => {
  it('says nothing while this build is the deployed one, or nothing answered', () => {
    expect(html('ok', null)).toBe('')
    expect(html('ok', 'test')).toBe('')
  })

  it('a deploy requiring newer chain rules: NEW VERSION, RELOAD TO MOVE, and one RELOAD', () => {
    const h = html('blocked', 'cutover')
    expect(h).toContain('hyperbar--broken')
    expect(h).toContain('NEW VERSION')
    expect(h).toContain('RELOAD TO MOVE')
    expect(buttons(h)).toEqual(['RELOAD'])
  })

  it('a required reload cannot be dismissed, even if its hint once was', () => {
    expect(html('blocked', 'cutover', 'cutover')).toContain('RELOAD TO MOVE')
  })

  it('only the build differs: a plain chip with RELOAD and a dismiss button a keyboard reaches, no block words', () => {
    const h = html('hint', 'newer')
    expect(h).toContain('NEW VERSION')
    expect(h).not.toContain('RELOAD TO MOVE')
    expect(h).not.toContain('hyperbar--broken')
    expect(buttons(h)).toEqual(['RELOAD', '\u2715'])
    expect(h).toContain('aria-label="Dismiss"')
  })

  it('never on the TV stream, blocked or not', () => {
    setBroadcastForTest(true)
    expect(html('blocked', 'cutover')).toBe('')
    expect(html('hint', 'newer')).toBe('')
  })

  it('a dismissed hint stays away for that build, and comes back for the next', () => {
    useVersionGate.setState({ verdict: 'hint', deployed: { build: 'newer', minChainEpoch: 1 } })
    useVersionGate.getState().dismissHint()
    const { hintDismissed } = useVersionGate.getState()
    expect(hintDismissed).toBe('newer')
    expect(html('hint', 'newer', hintDismissed)).toBe('')
    expect(html('hint', 'newer-still', hintDismissed)).toContain('NEW VERSION')
  })

  it('no em dashes in anything it says', () => {
    expect(html('blocked', 'cutover')).not.toContain('\u2014')
    expect(html('hint', 'newer')).not.toContain('\u2014')
  })
})
