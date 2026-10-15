/**
 * The question under the wordmark links to the /demo guided tour (arkinox,
 * 2026-10-15), in the same tab, and is out of sight while the tour runs so it
 * never invites you into the tour you are already on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ASK_EMOJI, AskBubble, AskRow, askHidden, TOUR_HREF } from '../AskBubble'
import { useDemo } from '../../store/useDemo'

const SRC = readFileSync(join(__dirname, '..', 'AskBubble.tsx'), 'utf8')

/** A server render reads the store's initial state, so the test's state is copied there first (as chatTag.test.ts does). */
const render = (): string => { Object.assign(useDemo.getInitialState(), useDemo.getState()); return renderToStaticMarkup(<AskBubble />) }

afterEach(() => { useDemo.setState({ active: false }); Object.assign(useDemo.getInitialState(), useDemo.getState()) })

describe('the ask row link', () => {
  it('goes to /demo', () => {
    expect(TOUR_HREF).toBe('/demo')
    const html = renderToStaticMarkup(<AskRow />)
    expect(html).toContain('href="/demo"')
  })

  it('opens in the same tab', () => {
    const html = renderToStaticMarkup(<AskRow />)
    expect(html).not.toContain('target=')
    expect(html).not.toContain('noopener')
  })

  it('no longer points anywhere off the site', () => {
    expect(SRC).not.toMatch(/youtube|CHANNEL_URL|https?:\/\//i)
  })

  it('keeps the placeholder face', () => {
    expect(ASK_EMOJI).toBe('🤔')
    expect(renderToStaticMarkup(<AskRow />)).toContain(ASK_EMOJI)
  })
})

describe('askHidden', () => {
  it('hides the row while the tour runs, on any address', () => {
    expect(askHidden(true, '/')).toBe(true)
    expect(askHidden(true, '/C/abc')).toBe(true)
  })

  it('hides the row on a /demo address before the tour has started', () => {
    expect(askHidden(false, '/demo')).toBe(true)
    expect(askHidden(false, '/demo/')).toBe(true)
    expect(askHidden(false, '/demo/no-cheat')).toBe(true)
    expect(askHidden(false, '/DEMO')).toBe(true)
  })

  it('shows the row everywhere else', () => {
    expect(askHidden(false, '/')).toBe(false)
    expect(askHidden(false, '/C/abc')).toBe(false)
    expect(askHidden(false, '/demonstration')).toBe(false)
  })
})

describe('AskBubble', () => {
  it('renders the row when no tour is running', () => {
    useDemo.setState({ active: false })
    expect(render()).toContain('class="ask"')
  })

  it('renders nothing while the tour is active', () => {
    useDemo.setState({ active: true })
    expect(render()).toBe('')
  })
})
