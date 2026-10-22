/**
 * The NFT card: a hidden message's nonfungible.cash claim link drawn as a
 * card in every state, never as its text. The link's key reaches the page
 * only inside CLAIM's href, which opens a new tab with noopener and
 * noreferrer. Nothing is drawn from nonfungible.cash by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MessageText } from '../CashuCard'
import { NftCard } from '../NftCard'
import { forgetNftAnswers, infoOf, nftCardModel } from '../nftCardModel'
import { findNftLinks, UNKNOWN_LINK, type NftLinkInfo } from '../../lib/nftLink'

const ID = '6fa4292bb0367fd9330d289a9c002d99'
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 37 + 5) & 0xff))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const LINK = `https://nonfungible.cash/claim/${ID}#${KEY}`
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function render(text: string, tags?: string[][]): { html: string; visible: string } {
  const html = renderToString(createElement(MessageText, { text, tags, words: (t: string) => createElement('blockquote', { className: 'words' }, t) }))
  return { html, visible: html.replace(/<[^>]*>/g, ' ') }
}

/** The card rendered after the site has given `answer` (the cache is filled first, so the first render shows it). */
async function cardAfter(answer: object | 'fail' | 404): Promise<string> {
  const fetchFn = (async () => {
    if (answer === 'fail') throw new TypeError('blocked')
    if (answer === 404) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(answer), { status: 200 })
  }) as unknown as typeof fetch
  await infoOf(ID, '/nft-link', fetchFn)
  return renderToString(createElement(NftCard, { link: findNftLinks(LINK)[0], api: '/nft-link' }))
}

const fetchSpy = vi.fn()
beforeEach(() => { forgetNftAnswers(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => { vi.unstubAllGlobals() })

describe('MessageText with a claim link', () => {
  it('draws the words and a card, and never shows the link or its key', () => {
    const { html, visible } = render(`under the disco floor ${LINK} good luck`)
    expect(html).toContain('<blockquote class="words">under the disco floor good luck</blockquote>')
    expect(visible).toContain('NFT')
    expect(visible).not.toContain(KEY.slice(0, 10))
    expect(visible).not.toContain('nonfungible.cash/claim')
  })

  it('CLAIM opens the whole link, key and all, in a new tab, with noopener, noreferrer and no referrer', () => {
    const { html } = render(LINK)
    const a = html.match(/<a [^>]*class="nftcard__act"[^>]*>/)?.[0] ?? ''
    expect(a).toContain(`href="${LINK}"`)
    expect(a).toContain('target="_blank"')
    expect(a).toContain('rel="noopener noreferrer"')
    expect(a).toContain('referrerPolicy="no-referrer"')
    // The key appears in that href and nowhere else on the page.
    expect(html.split(KEY).length - 1).toBe(1)
  })

  it('a message that is nothing but a link draws no empty words block', () => {
    const { html } = render(LINK)
    expect(html).not.toContain('class="words"')
    expect((html.match(/class="nftcard /g) ?? []).length).toBe(1)
  })

  it('gives every link its own card, and a coin and an NFT side by side', () => {
    const other = `https://nonfungible.cash/claim/${'ab'.repeat(16)}#${KEY}`
    const coin = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 21, secret: 'a', C: '02aa' }] }], unit: 'sat' })).replace(/=+$/, '')
    const { html, visible } = render(`one ${LINK} two ${other} and sats ${coin}`)
    expect((html.match(/class="nftcard /g) ?? []).length).toBe(2)
    expect((html.match(/class="cashucard /g) ?? []).length).toBe(1)
    expect(visible).toContain('21 sats')
    expect(html).toContain('<blockquote class="words">one two and sats</blockquote>')
  })

  it('a plain message and a look-alike are drawn as written', () => {
    const fake = `https://nonfungible.cash/claim/${ID}`
    expect(render(`see ${fake}`).html).toBe(`<blockquote class="words">see ${fake}</blockquote>`)
  })

  it('makes no request while rendering, and draws no picture from nonfungible.cash', () => {
    const { html } = render(LINK)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(html).not.toContain('<img')
    expect(html).not.toContain('/api/images/')
  })

  it('shows the message\'s own sealed picture, a data URI, when it holds one link', () => {
    const tags = [['imeta', `url ${PNG}`, 'm image/png', 'dim 1x1']]
    expect(render(LINK, tags).html).toContain(`<img class="nftcard__thumb" src="${PNG}"`)
  })

  it('never shows a picture from an address, nor one picture for several links', () => {
    expect(render(LINK, [['imeta', 'url https://evil.example/x.png', 'm image/png', 'dim 1x1']]).html).not.toContain('<img')
    const other = `https://nonfungible.cash/claim/${'ab'.repeat(16)}#${KEY}`
    expect(render(`${LINK} ${other}`, [['imeta', `url ${PNG}`, 'm image/png', 'dim 1x1']]).html).not.toContain('<img')
  })

  it('says nothing in visible prose: the honesty line is behind EXPLAIN and in CLAIM\'s tooltip', () => {
    const { html } = render(LINK)
    expect(html).not.toMatch(/<p[ >]/)
    expect(html).toContain('EXPLAIN')
    expect(html).toMatch(/title="[^"]*Not yours until then/)
  })
})

describe('the card in each state', () => {
  it('unknown, which is every card while the check is off: CHECK ON SITE and CLAIM', () => {
    const m = nftCardModel('unknown', UNKNOWN_LINK)
    expect(m.status).toBe('CHECK ON SITE')
    expect(m.open).toBe('CLAIM')
    expect(m.password).toBe(false)
    expect(m.title).toBeNull()
    const { visible } = render(LINK)
    expect(visible).toContain('CHECK ON SITE')
    expect(visible).toContain('CLAIM')
    expect(visible).toContain('COPY LINK')
  })

  it('unclaimed, with its title and PASSWORD', async () => {
    const html = await cardAfter({ status: 'open', title: 'THE DEALER #7', protected: true, h: 'cd'.repeat(32) })
    expect(html).toContain('UNCLAIMED')
    expect(html).toContain('THE DEALER #7')
    expect(html).toContain('PASSWORD')
    expect(html).toContain('>CLAIM<')
    // Its picture is named, but only loads on a tap: a button, not an img.
    expect(html).not.toContain('<img')
    expect(html).toContain('nftcard__thumb--tap')
  })

  it('claimed: CLAIMED, and the button only opens the site', async () => {
    const html = await cardAfter({ status: 'claimed', title: 'T', protected: false })
    expect(html).toContain('nftcard--claimed')
    expect(html).toContain('CLAIMED')
    expect(html).toContain('OPEN ON SITE')
    expect(html).not.toContain('PASSWORD')
  })

  it('cancelled by the hider', async () => {
    const html = await cardAfter({ status: 'void', title: 'T' })
    expect(html).toContain('CANCELLED')
    expect(html).toContain('OPEN ON SITE')
  })

  it('a link the site does not have', async () => {
    expect(await cardAfter(404)).toContain('NOT FOUND')
  })

  it('a site that cannot be reached is CHECK ON SITE, never claimed', async () => {
    const html = await cardAfter('fail')
    expect(html).toContain('CHECK ON SITE')
    expect(html).toContain('>CLAIM<')
  })

  it('a title is text, never markup', async () => {
    const html = await cardAfter({ status: 'open', title: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('checking, while the first answer is on its way', () => {
    expect(nftCardModel('checking', UNKNOWN_LINK).status).toBe('CHECKING')
  })
})

describe('asking, as useCashu asks a mint', () => {
  const answer = (status: string) => vi.fn(async () => new Response(JSON.stringify({ status }), { status: 200 }))

  it('asks once a minute at most', async () => {
    const f = answer('open')
    await infoOf(ID, '/x', f as unknown as typeof fetch)
    await infoOf(ID, '/x', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('never asks again about a claimed link', async () => {
    const f = answer('claimed')
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(now)
    await infoOf(ID, '/x', f as unknown as typeof fetch)
    clock.mockReturnValue(now + 10 * 60_000)
    expect((await infoOf(ID, '/x', f as unknown as typeof fetch)).state).toBe('claimed')
    expect(f).toHaveBeenCalledTimes(1)
    clock.mockRestore()
  })

  it('an unknown answer never overwrites a definite one', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(now)
    await infoOf(ID, '/x', answer('open') as unknown as typeof fetch)
    clock.mockReturnValue(now + 2 * 60_000)
    const info: NftLinkInfo = await infoOf(ID, '/x', (async () => { throw new TypeError('down') }) as unknown as typeof fetch)
    expect(info.state).toBe('unclaimed')
    clock.mockRestore()
  })
})
