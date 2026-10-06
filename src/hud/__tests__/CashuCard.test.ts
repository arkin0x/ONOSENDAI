/**
 * MessageText, rendered: a plain message is drawn as written, and a message
 * with a Cashu token draws its words and a card, never the token's text. The
 * token reaches the page only inside the OPEN IN WALLET link. Rendered to a
 * string, so this is the first render: the card before the mint has answered.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MessageText } from '../CashuCard'

const V3 = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 16, secret: 'a', C: '02aa' }, { id: '00ad', amount: 5, secret: 'b', C: '02bb' }] }], unit: 'sat', memo: 'chest' })).replace(/=+$/, '')

/** The page as rendered, and the text a reader would see on it (tags and attributes removed). */
function render(text: string): { html: string; visible: string } {
  const html = renderToString(createElement(MessageText, { text, words: (t: string) => createElement('blockquote', { className: 'words' }, t) }))
  return { html, visible: html.replace(/<[^>]*>/g, ' ') }
}

describe('MessageText', () => {
  it('draws a plain message exactly as before', () => {
    const { html } = render('meet me at the fountain')
    expect(html).toBe('<blockquote class="words">meet me at the fountain</blockquote>')
  })

  it('draws a message with a token as its words and a card, and never shows the token', () => {
    const { html, visible } = render(`for the drinks cashu:${V3}`)
    expect(visible).not.toContain(V3.slice(0, 24))
    expect(visible).not.toContain('cashu:')
    expect(html).toContain('<blockquote class="words">for the drinks</blockquote>')
    expect(visible).toContain('CASHU TOKEN')
    expect(visible).toContain('21 sats')
    expect(visible).toContain('CHECKING')
    expect(visible).toContain('mint.example')
    expect(visible).toContain('chest')
  })

  it('hands the bare token to OPEN IN WALLET as a cashu: link', () => {
    const { html } = render(`for the drinks cashu:${V3}`)
    expect(html).toContain(`href="cashu:${V3}"`)
    expect(html).toContain('OPEN IN WALLET')
    expect(html).toContain('COPY TOKEN')
  })

  it('gives every token its own card, so a second token is never hidden by the first', () => {
    const second = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://other.mint', proofs: [{ id: '00ad', amount: 100, secret: 'c', C: '02cc' }] }], unit: 'sat' })).replace(/=+$/, '')
    const { html, visible } = render(`one for you ${V3} and one for your friend ${second}`)
    expect((html.match(/class="cashucard /g) ?? []).length).toBe(2)
    expect(html).toContain(`href="cashu:${V3}"`)
    expect(html).toContain(`href="cashu:${second}"`)
    expect(visible).toContain('21 sats')
    expect(visible).toContain('100 sats')
    expect(visible).toContain('other.mint')
    expect(visible).not.toContain(second.slice(0, 24))
  })

  it('a message that is nothing but a token draws no empty words block', () => {
    const { html } = render(V3)
    expect(html).not.toContain('class="words"')
    expect(html).toContain('CASHU TOKEN')
  })

  it('a token cut short is still a cashu card, says it cannot be read, and keeps its copy button', () => {
    const cut = V3.slice(0, 60)
    const { html, visible } = render(`for the drinks ${cut}`)
    expect(visible).not.toContain(cut.slice(0, 24))
    expect(visible).toContain('CASHU TOKEN')
    expect(visible).toContain('UNREADABLE')
    expect(visible).toContain('could not be read')
    expect(html).toContain('COPY TOKEN')
  })
})
