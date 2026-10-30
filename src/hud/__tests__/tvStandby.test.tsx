/**
 * tvStandby.test.tsx: the stream's stand-by card (hud/TvStandby): a render
 * error anywhere under it, WebGL refused above all, puts up TV's own NO
 * SIGNAL with the stream's address, drawn without WebGL, and stands by
 * once (lib/tv/standby); and main.tsx puts it round the app on the stream
 * only.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ErrorInfo, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const standBy = vi.fn(() => () => {})
vi.mock('../../lib/tv/standby', () => ({ standBy: (...a: unknown[]) => standBy(...(a as [])) }))

const { TvStandby } = await import('../TvStandby')
const { BROADCAST_TAG } = await import('../../lib/tv/broadcast')

describe('the stream\'s stand-by', () => {
  it('draws what it guards while nothing has gone wrong', () => {
    const b = new TvStandby({ children: 'the picture' })
    expect(b.render()).toBe('the picture')
  })

  it('takes any render error, WebGL refused among them, and puts NO SIGNAL up with the address, in TV\'s words only', () => {
    const e = new Error('Error creating WebGL context.')
    const b = new TvStandby({ children: 'the picture' })
    b.state = TvStandby.getDerivedStateFromError(e)
    const html = renderToStaticMarkup(b.render() as ReactElement)
    expect(html).toContain('CYBERSPACE')
    expect(html).toContain('NO SIGNAL')
    expect(html).toContain(BROADCAST_TAG)
    expect(html).not.toContain('the picture')
    // No canvas: it has to draw when WebGL will not.
    expect(html).not.toContain('<canvas')
  })

  it('stands by once for however many errors arrive, and stops asking when it goes', () => {
    standBy.mockClear()
    const stop = vi.fn()
    standBy.mockReturnValueOnce(stop)
    const b = new TvStandby({ children: null })
    const info = { componentStack: '' } as ErrorInfo
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    b.componentDidCatch(new Error('Error creating WebGL context.'), info)
    b.componentDidCatch(new Error('Error creating WebGL context.'), info)
    quiet.mockRestore()
    expect(standBy).toHaveBeenCalledTimes(1)
    b.componentWillUnmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('is round the app on the stream only (main.tsx)', () => {
    const main = readFileSync(join(__dirname, '../../main.tsx'), 'utf8')
    expect(main).toMatch(/isBroadcast\(\) \? <TvStandby><App \/><\/TvStandby> : <App \/>/)
  })
})
