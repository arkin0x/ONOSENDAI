/**
 * The claim-link recognizer: only links the site itself makes
 * (portfolio_web/src/link.mjs: `${origin}/claim/${id}#${b64url(32 bytes)}`),
 * found anywhere in a message, every one of them, and never a look-alike.
 */
import { describe, expect, it, vi } from 'vitest'
import { checkNftLink, countNftLinks, findNftLinks, hasNftLink, NFT_LINK_API, readNftLinkAnswer, replaceNftLinks, textWithoutNftLinks } from '../nftLink'
import { messagePreview } from '../hidden'
import { messageName } from '../deleteWords'
import { messageBillboard } from '../../scene/WorldMessages'

/** A key exactly as the site's b64url makes one: 32 bytes, unpadded base64url. */
function keyOf(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 17 + 250) & 0xff)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const ID = '6fa4292bb0367fd9330d289a9c002d99'
const ID2 = '0123456789abcdef0123456789abcdef'
const KEY = keyOf(1)
const KEY2 = keyOf(2)
const LINK = `https://nonfungible.cash/claim/${ID}#${KEY}`
const LINK2 = `https://nonfungible.cash/claim/${ID2}#${KEY2}`

describe('findNftLinks: real links', () => {
  it('makes 43-character keys, as the site does', () => {
    expect(KEY).toHaveLength(43)
    expect(KEY).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('finds a link that is the whole message', () => {
    expect(findNftLinks(LINK)).toEqual([{ id: ID, key: KEY, url: LINK }])
  })

  it('finds a link inside words, and around punctuation', () => {
    for (const text of [
      `for the winner: ${LINK} good luck`,
      `(${LINK})`,
      `<${LINK}>`,
      `"${LINK}"`,
      `claim it here ${LINK}.`,
      `found it? ${LINK}!`,
      `is this yours ${LINK}?`,
      `line one\n${LINK}\nline three`,
      `[the dealer](${LINK})`,
    ]) {
      expect(findNftLinks(text).map((l) => l.url), text).toEqual([LINK])
    }
  })

  it('finds several links in one message, in order, once each', () => {
    const text = `one ${LINK} two ${LINK2} and the first again ${LINK}`
    expect(findNftLinks(text).map((l) => l.id)).toEqual([ID, ID2])
  })

  it('finds a link after the marks people put before one', () => {
    for (const before of ['link:', '\u0060', '\u2014', '\u2013', ' \u2014 ', '\u200b', '> ', '| ']) {
      expect(findNftLinks(`claim ${before}${LINK}`).map((l) => l.id), JSON.stringify(before)).toEqual([ID])
    }
    expect(findNftLinks('\u0060' + LINK + '\u0060').map((l) => l.id)).toEqual([ID])
  })

  it('reads the scheme and host in any case, and opens the link as the site writes it', () => {
    const shouted = `Https://NonFungible.Cash/claim/${ID}#${KEY}`
    expect(findNftLinks(shouted)).toEqual([{ id: ID, key: KEY, url: LINK }])
    expect(textWithoutNftLinks(`see ${shouted}`)).toBe('see')
  })

  it('finds two links with only a space between them', () => {
    expect(findNftLinks(`${LINK} ${LINK2}`).map((l) => l.id)).toEqual([ID, ID2])
  })

  it('a key ending in any of its sixteen possible last characters', () => {
    for (const last of 'AEIMQUYcgkosw048') {
      expect(hasNftLink(`https://nonfungible.cash/claim/${ID}#${KEY.slice(0, 42)}${last}`)).toBe(true)
    }
  })
})

describe('findNftLinks: look-alikes', () => {
  const bad: Array<[string, string]> = [
    ['no key', `https://nonfungible.cash/claim/${ID}`],
    ['empty key', `https://nonfungible.cash/claim/${ID}#`],
    ['short key', `https://nonfungible.cash/claim/${ID}#${KEY.slice(0, 42)}`],
    ['long key', `https://nonfungible.cash/claim/${ID}#${KEY}A`],
    ['padded key', `https://nonfungible.cash/claim/${ID}#${KEY}=`],
    ['key with more fragment', `https://nonfungible.cash/claim/${ID}#${KEY}&pw=1`],
    ['impossible last key character', `https://nonfungible.cash/claim/${ID}#${KEY.slice(0, 42)}B`],
    ['standard base64 key', `https://nonfungible.cash/claim/${ID}#${KEY.slice(0, 41)}+A`],
    ['short id', `https://nonfungible.cash/claim/${ID.slice(1)}#${KEY}`],
    ['long id', `https://nonfungible.cash/claim/${ID}0#${KEY}`],
    ['uppercase id', `https://nonfungible.cash/claim/${ID.toUpperCase()}#${KEY}`],
    ['http', `http://nonfungible.cash/claim/${ID}#${KEY}`],
    ['www', `https://www.nonfungible.cash/claim/${ID}#${KEY}`],
    ['other host ending in the name', `https://evilnonfungible.cash/claim/${ID}#${KEY}`],
    ['the name as a subdomain', `https://nonfungible.cash.evil.example/claim/${ID}#${KEY}`],
    ['userinfo trick', `https://nonfungible.cash@evil.example/claim/${ID}#${KEY}`],
    ['port', `https://nonfungible.cash:8443/claim/${ID}#${KEY}`],
    ['other path', `https://nonfungible.cash/c/${ID}#${KEY}`],
    ['trailing slash', `https://nonfungible.cash/claim/${ID}/#${KEY}`],
    ['query', `https://nonfungible.cash/claim/${ID}?x=1#${KEY}`],
    ['inside another link', `https://evil.example/https://nonfungible.cash/claim/${ID}#${KEY}`],
    ['as a query value', `https://evil.example/?u=https://nonfungible.cash/claim/${ID}#${KEY}`],
    ['glued to a word', `xhttps://nonfungible.cash/claim/${ID}#${KEY}`],
    ['no scheme', `nonfungible.cash/claim/${ID}#${KEY}`],
    ['a cashu token', 'cashuBo2FteBtodHRwczovL21pbnQuZXhhbXBsZS5jb20'],
  ]
  for (const [why, text] of bad) {
    it(`refuses ${why}`, () => {
      expect(findNftLinks(text)).toEqual([])
      expect(findNftLinks(`look: ${text} here`)).toEqual([])
    })
  }

  it('reads nothing from empty text', () => {
    expect(findNftLinks('')).toEqual([])
    expect(findNftLinks(null)).toEqual([])
    expect(findNftLinks(undefined)).toEqual([])
  })
})

// Spec 7.7 Contents: "A link glued to the end of a word, or standing inside another URL's path or query, is not counted."
describe('countNftLinks: a bag\'s nft count', () => {
  it('does not count a link inside another URL\'s path or query, after any mark a URL may hold', () => {
    for (const before of [';', ',', ':', '(', "'", '*']) {
      for (const url of ['https://a.example/?b=1', 'https://a.example/x', 'HTTPS://A.EXAMPLE/x', 'ftp://a.example/x', 'https://a.example/#top;https://b.example/?q']) {
        const text = `${url}${before}${LINK}`
        expect(countNftLinks(text), text).toBe(0)
        expect(countNftLinks(`see ${text} now`), text).toBe(0)
      }
    }
    // The spec's own example.
    expect(countNftLinks(`https://a.example/?b=1;${LINK}`)).toBe(0)
  })

  it('counts a link after those marks in words, in a fragment, and after a URL that ended', () => {
    for (const text of [LINK, `see;${LINK}`, `one,${LINK}`, `(${LINK})`, `'${LINK}'`, `*${LINK}*`, `link:${LINK}`, `a.example/?b=1;${LINK}`,
      `[https://a.example](${LINK})`, `https://a.example/x ${LINK}`, `https://a.example/x, ${LINK}`, `<https://a.example/>;${LINK}`, `"https://a.example/";${LINK}`,
      `https://a.example/x\u2014${LINK}`, `https://a.example/x|${LINK}`, `https://a.example/#top;${LINK}`, `https://a.example/\u00e9;${LINK}`]) {
      expect(countNftLinks(text), text).toBe(1)
    }
    // Two links joined by a mark: the second is in the first one's fragment, so both count.
    for (const mark of [',', ';', ':', '(']) expect(countNftLinks(`${LINK}${mark}${LINK2}`), mark).toBe(2)
    expect(countNftLinks(`${LINK}, ${LINK2} and ${LINK}`)).toBe(2)
    expect(countNftLinks(`https://a.example/?b=1;${LINK2} and ${LINK}`)).toBe(1)
    expect(countNftLinks('')).toBe(0)
    expect(countNftLinks(null)).toBe(0)
  })

  it('counts what findNftLinks finds wherever no other URL is in the way', () => {
    const text = `one ${LINK} two ${LINK2} and the first again ${LINK}, ${'x'.repeat(50)}`
    expect(countNftLinks(text)).toBe(findNftLinks(text).length)
  })

  it('one pass over the text, however many links are joined into one run', () => {
    const many = Array.from({ length: 2000 }, () => LINK).join(',')
    const t0 = performance.now()
    // The first is in the query; the `#` in its key starts the outer URL's fragment, so the rest (one link, repeated) counts once.
    expect(countNftLinks(`https://a.example/?b=1;${many}`)).toBe(1)
    expect(performance.now() - t0).toBeLessThan(500)
  })

  it('still makes a card of a link inside another URL, and keeps its key out of the words, rows and the scene', () => {
    const text = `see https://a.example/?b=1;${LINK} and ${LINK2}`
    expect(findNftLinks(text).map((l) => l.id)).toEqual([ID, ID2])
    expect(hasNftLink(`https://a.example/?b=1;${LINK}`)).toBe(true)
    for (const shown of [textWithoutNftLinks(text), messagePreview(text, 400), messageName(text), messageBillboard(text)]) expect(shown, shown).not.toContain(KEY)
  })
})

describe('taking links out of words', () => {
  it('leaves the words, with their line breaks, and closes the gap', () => {
    expect(textWithoutNftLinks(`for the winner ${LINK} good luck`)).toBe('for the winner good luck')
    expect(textWithoutNftLinks(`under the floor\n${LINK}\nlast line`)).toBe('under the floor\n\nlast line')
    expect(textWithoutNftLinks(LINK)).toBe('')
    expect(textWithoutNftLinks(`${LINK} ${LINK2}`)).toBe('')
  })

  it('keeps what came right before a link', () => {
    expect(replaceNftLinks(`(${LINK})`, 'X')).toBe('(X)')
  })

  it('leaves a look-alike as written', () => {
    const fake = `https://nonfungible.cash/claim/${ID}`
    expect(textWithoutNftLinks(`see ${fake}`)).toBe(`see ${fake}`)
  })

  it('never shows the key in a row, a preview, a delete card or the scene', () => {
    const text = `the dealer ${LINK}`
    for (const shown of [messagePreview(text, 160), messagePreview(text), messageName(text), messageBillboard(text)]) {
      expect(shown).not.toContain(KEY.slice(0, 12))
      expect(shown).not.toContain(ID.slice(0, 12))
    }
    expect(messagePreview(text, 160)).toBe('the dealer NFT link')
    expect(messagePreview(LINK)).toBe('NFT link')
    expect(messageName(text)).toBe('the dealer')
  })
})

describe('the site\'s answer about a link', () => {
  it('reads each status', () => {
    const h = 'ab'.repeat(32)
    expect(readNftLinkAnswer({ status: 'open', title: '  THE DEALER   #7 ', protected: false, h })).toEqual({ state: 'unclaimed', title: 'THE DEALER #7', password: false, picture: h })
    expect(readNftLinkAnswer({ status: 'claimed', title: 'x', protected: true, h })).toMatchObject({ state: 'claimed', password: true })
    expect(readNftLinkAnswer({ status: 'void', title: 'x' })).toMatchObject({ state: 'cancelled', password: null, picture: null })
  })

  it('anything odd is unknown, and an odd picture hash is dropped', () => {
    expect(readNftLinkAnswer(null).state).toBe('unknown')
    expect(readNftLinkAnswer({ status: 'gone' }).state).toBe('unknown')
    expect(readNftLinkAnswer({ status: 'open', h: '../../etc' }).picture).toBeNull()
    expect(readNftLinkAnswer({ status: 'open', title: 'x'.repeat(200) }).title).toHaveLength(80)
  })

  it('asks by id alone, never with the key, and without credentials or a referrer', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'open', title: 'T' }), { status: 200 }))
    const info = await checkNftLink(ID, '/nft-link/', fetchFn as unknown as typeof fetch)
    expect(info.state).toBe('unclaimed')
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0][0]).toBe(`/nft-link/${ID}`)
    expect(calls[0][0]).not.toContain('#')
    expect(calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('a 404 is a link the site does not have; a failure is unknown', async () => {
    expect((await checkNftLink(ID, '/x', (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch)).state).toBe('missing')
    expect((await checkNftLink(ID, '/x', (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch)).state).toBe('unknown')
    expect((await checkNftLink(ID, '/x', (async () => { throw new TypeError('blocked by CORS') }) as unknown as typeof fetch)).state).toBe('unknown')
    expect((await checkNftLink('nothex', '/x', (async () => new Response('{}')) as unknown as typeof fetch)).state).toBe('unknown')
  })

  it('is off: nothing is asked of nonfungible.cash, which sends no CORS headers', () => {
    expect(NFT_LINK_API).toBeNull()
  })
})
