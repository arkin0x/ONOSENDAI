import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { INSTRUMENT_GROUPS, InstrumentStack } from '../InstrumentStack'
import { TOAST_MS, toastClockMs } from '../../store/useToast'

describe('the instrument stack groups (arkinox, 2026-10-14)', () => {
  it('draws RETURN chips on top, status in the middle, toasts at the bottom', () => {
    expect(INSTRUMENT_GROUPS).toEqual(['return', 'status', 'toast'])
  })

  it('keeps that order whatever order the groups are handed in', () => {
    const html = renderToStaticMarkup(
      <InstrumentStack groups={{ toast: <i>toast</i>, status: <i>status</i>, return: <i>return</i> }} />,
    )
    const at = (s: string): number => html.indexOf(`<i>${s}</i>`)
    expect(at('return')).toBeGreaterThanOrEqual(0)
    expect(at('return')).toBeLessThan(at('status'))
    expect(at('status')).toBeLessThan(at('toast'))
    expect(html).toContain('instruments__group--return')
  })
})

describe('toast clocks', () => {
  it('a sticky toast has no clock: it waits for a tap', () => {
    expect(toastClockMs({ sticky: true, ms: 4000 })).toBeNull()
  })
  it('others keep their own time, or the default', () => {
    expect(toastClockMs({ ms: 4000 })).toBe(4000)
    expect(toastClockMs({})).toBe(TOAST_MS)
  })
})
