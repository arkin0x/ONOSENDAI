import { describe, expect, it } from 'vitest'
import { messageBillboard } from './WorldMessages'

/** A Cashu token as it really arrives: one word, thousands of characters. */
const token = `cashuBo2FteCJodHRwczovL21pbnQubWluaWJpdHMuY2FzaCIsInVuaXQiOiJzYXQiLCJwcm9v${'A'.repeat(1800)}`

describe('a message on the billboard', () => {
  it('breaks a word longer than the line instead of running off the screen', () => {
    const out = messageBillboard(token)
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28)
  })

  it('is cut short: the whole message is one tap away', () => {
    const out = messageBillboard(token)
    expect(out.replace(/\n/g, '').length).toBeLessThan(200)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves a short message alone', () => {
    expect(messageBillboard('a note')).toBe('a note')
  })

  it('still wraps ordinary prose on its spaces', () => {
    const prose = 'the sky above the port was the color of television tuned to a dead channel'
    const lines = messageBillboard(prose).split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(28)
      // Words are kept whole when they fit.
      expect(line.startsWith(' ')).toBe(false)
    }
    expect(messageBillboard(prose).replace(/\n/g, ' ')).toContain('television')
  })

  it('never grows past six lines', () => {
    expect(messageBillboard('word '.repeat(300)).split('\n').length).toBeLessThanOrEqual(6)
  })

  it('handles an empty message without throwing', () => {
    expect(messageBillboard('   ')).toBe('')
  })
})
