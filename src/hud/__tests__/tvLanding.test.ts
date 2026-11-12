/**
 * tvLanding.test.ts: a page that lands on /tv draws TV's own layout from its
 * first render (App.tsx). TV starts in an effect, after that render, and for
 * that one render the panels used to mount and ask both relays for every bag
 * and the avatars' recent moves, megabytes queued on the same sockets ahead
 * of TV's first question (2026-11-11: about 5 MB a relay before TUNING could
 * end). The whole App is too heavy to render here, so its source is read, as
 * tvStandby.test.tsx reads main.tsx.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8')

describe('landing on /tv', () => {
  it('the first render is TV\'s layout, until the effect that starts TV has run', () => {
    expect(app).toMatch(/const \[tvLanding, setTvLanding\] = useState\(\(\) => isTvPath\(window\.location\.pathname\)\)/)
    expect(app).toMatch(/if \(tv \|\| tvLanding\) \{\s*return \(/)
  })

  it('ends with that effect, whether TV started or not, so an address TV cannot open shows the app', () => {
    expect(app).toMatch(/if \(isTvPath\(window\.location\.pathname\)\) open\(\)\s*setTvLanding\(false\)/)
  })

  it('its hooks stay above every return (rules of hooks)', () => {
    const body = app.slice(app.indexOf('export default function App'))
    expect(body.indexOf('useState(() => isTvPath')).toBeLessThan(body.indexOf('if (tv || tvLanding)'))
  })
})
