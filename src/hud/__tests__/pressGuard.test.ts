import { describe, expect, it } from 'vitest'
import { pressGuard } from '../pressGuard'

// arkinox, 2026-10-08: "if chat is open and you press exactly where the chat
// chip would be, the chat will flash and fail to close." The tap folds the
// chat, the CHAT chip is drawn back under the finger, and a phone sends the
// tap's click to whatever is under the finger by then: the chip, which
// reopens the chat. The chip only takes a click whose press began on it.
describe('a click counts only if the press began on the element', () => {
  it('a click with no press on the element is a ghost and is refused', () => {
    const g = pressGuard()
    expect(g.real(1, 1000)).toBe(false)
  })

  it('a press then its click is real', () => {
    const g = pressGuard()
    g.press(1000)
    expect(g.real(1, 1080)).toBe(true)
  })

  it('one press is good for one click', () => {
    const g = pressGuard()
    g.press(1000)
    expect(g.real(1, 1080)).toBe(true)
    expect(g.real(1, 1090)).toBe(false)
  })

  it('a press long ago does not vouch for a click now', () => {
    const g = pressGuard()
    g.press(1000)
    expect(g.real(1, 5000)).toBe(false)
  })

  it('a keyboard click (Enter or Space, detail 0) needs no press', () => {
    const g = pressGuard()
    expect(g.real(0, 1000)).toBe(true)
  })
})
