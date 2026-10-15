/**
 * smoke.mjs: ONOSENDAI's demo-critical flows, end to end, offline
 * (2026-10-16, before the CS class).
 *
 * Runs the dev build (DEV hooks: window.__store, __rig) in Chromium at phone
 * (412x915 @2.625, touch) and desktop (1920x1080 @1.25) sizes. Every relay is
 * the in-process relay of smoke-lib.mjs, seeded with real public events
 * (scripts/smoke-seed/seed.json, fetched read-only by smoke-seed/fetch.mjs
 * when missing), so nothing is ever published. A throwaway local key signs,
 * LOCAL from the first frame.
 *
 * Each flow records pass/fail, page errors raised during it, a screenshot,
 * and (on phone) HUD elements that overlap the movement controls. Writes
 * <out>/SMOKE-REPORT.md and <out>/results.json.
 *
 * Usage: start a FRESH dev server (`npx vite --port 5251`), then
 *   PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/smoke.mjs http://127.0.0.1:5251 <out dir> [phone|desktop|both] [flow,flow]
 * Fresh matters: the flows reach the app's stores with import('/src/...'),
 * and after a hot reload Vite serves an edited module under a new URL, so the
 * import returns a second, empty copy of the store and flows fail for no
 * reason in the app. Restart the server after pulling. SMOKE_DPR=2.625 for
 * true-resolution phone screenshots (slow under software GL).
 * A full run takes 30 to 40 minutes here (software GL, a cold hyperspace line
 * per reload).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { launch } from './smoke-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const [base, out, which = 'both', only] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const seedFile = path.join(here, 'smoke-seed', 'seed.json')
if (!fs.existsSync(seedFile)) execFileSync('node', [path.join(here, 'smoke-seed', 'fetch.mjs'), seedFile], { stdio: 'inherit' })
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))

const ARKINOX = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const XOR = 'd4e4c079ad8e2f84af0da56f95c161431226934398e78c7a3c244e2547f6f3d4'
const PORT_ROOT = '6edfc6badd201e338a5003ac86485f273838406c7825caae704e71824c985e93' // block 971,270
const LANDFALL_ROOT = '0cfb54e522b07bd1a381adc774ec1851590ef4c3add83958135106534569f970' // block 900,000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runDevice(device) {
  const sk = generateSecretKey()
  const me = getPublicKey(sk)
  // My own agent: a bot profile naming me as its operator, so its card offers TALK.
  const agentSk = generateSecretKey()
  const myAgent = getPublicKey(agentSk)
  const agentProfile = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [['p', me, '', 'operator']], content: JSON.stringify({ name: 'SMOKEBOT', bot: true }) }, agentSk)
  const { browser, page, stats, errors } = await launch({ phone: device === 'phone', url: base, sk, seed: [...seed, agentProfile] })
  const results = []
  const st = (fn) => page.evaluate(fn)
  const mod = (p, expr) => page.evaluate(async ([p, expr]) => { const m = await import(p); return (0, eval)(`(m) => ${expr}`)(m) }, [p, expr])
  const store = (expr) => page.evaluate((expr) => (0, eval)(`(s) => ${expr}`)(window.__store.getState()), expr)
  const press = (sel) => page.locator(sel).first().dispatchEvent('pointerdown')
  const shot = (name) => page.screenshot({ path: path.join(out, `${device}-${name}.png`) })
  const waitFor = async (fn, ms, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(every) } return false }
  const text = () => page.evaluate(() => document.body.innerText)

  const overlaps = async () => {
    return page.evaluate(() => {
      const ctl = [...document.querySelectorAll('.touchpad, .touchops, .compass-3d--tappable')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
      const hud = [...document.querySelectorAll('.hyperbar, .chip, .syncwarn__panel, .goalgroup, .hamburger-menu, .toast__build, .chatdock, .deploybar, .routeov')]
        .filter((e) => !e.closest('.touchpad, .touchops, .compass-3d') && !e.closest('.modal'))
      const hits = []
      for (const e of hud) {
        const r = e.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        for (const c of ctl) {
          const ix = Math.min(r.right, c.right) - Math.max(r.left, c.left)
          const iy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top)
          if (ix > 4 && iy > 4) hits.push(`${e.className.toString().split(' ').slice(0, 2).join('.')} (${(e.textContent || '').trim().slice(0, 24)})`)
        }
      }
      return [...new Set(hits)]
    })
  }

  async function flow(name, fn, limitMs = 150_000) {
    if (only && !only.split(',').includes(name)) return
    const before = errors.length
    let ok = false, note = ''
    try {
      const r = await Promise.race([fn(), sleep(limitMs).then(() => { throw new Error(`timed out after ${limitMs / 1000} s`) })])
      ok = r !== false && !(typeof r === 'string')
      note = typeof r === 'string' ? r : ''
    } catch (e) { note = e.message.split('\n')[0].slice(0, 300) }
    const errs = errors.slice(before).filter((e) => !/Failed to fetch|ERR_|net::|favicon|WebSocket|status of 4\d\d/.test(e))
    let over = []
    try { await shot(name); over = await overlaps() } catch {}
    // Leave no modal open for the next flow: the app's own Escape stack,
    // drained while a modal is on top (the menu and chips are left alone).
    try {
      await page.evaluate(async () => { const m = await import('/src/hooks/useEscape.ts'); for (let i = 0; i < 8 && m.modalUp(); i++) { m.escapeTop(); await new Promise((r) => setTimeout(r, 150)) } })
      await sleep(400)
    } catch {}
    if (errs.length) { ok = false; note = (note ? note + '; ' : '') + errs.slice(0, 2).join(' | ') }
    results.push({ device, flow: name, ok, note, overlaps: over })
    console.log(`${device} ${ok ? 'PASS' : 'FAIL'} ${name}${note ? ': ' + note : ''}${over.length ? ' OVERLAP ' + over.join(', ') : ''}`)
  }
  const home = async () => {
    await st(() => { const s = window.__store.getState(); if (s.walking) s.cancel?.(); s.spectate && s.endSpectate(); s.focus && s.clearFocus() })
    await sleep(500)
  }

  page.setDefaultNavigationTimeout(120_000)
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.evaluate(() => { Error.stackTraceLimit = 40 })

  await flow('boot', async () => {
    if (!await waitFor(() => page.locator('.touchops__commit').count().then((n) => n > 0), 60_000)) return 'controls never appeared'
    await sleep(4000)
    if (await store('s.live') !== false) throw new Error('ABORT: not LOCAL')
    return await page.locator('canvas').count() > 0 || 'no canvas'
  })

  await flow('hop', async () => {
    const n0 = await store('s.events.length')
    await page.keyboard.press('d'); await sleep(300)
    await press('.touchops__commit')
    if (!await waitFor(() => store(`s.events.length > ${n0} && s.proof.status !== 'computing'`), 90_000)) return `no hop landed: ${await store('s.proof.message')}`
    // A second hop, now that the chain exists: confirmHead against the relay.
    const n1 = await store('s.events.length')
    await page.keyboard.press('w'); await sleep(300)
    await press('.touchops__commit')
    if (!await waitFor(() => store(`s.events.length > ${n1} && s.proof.status !== 'computing'`), 90_000)) return `second hop did not land: ${await store('s.proof.message')}`
    return true
  })

  await flow('view-no-camera-jump', async () => {
    const cam = () => page.evaluate(() => window.__rig?.())
    const before = await cam()
    await press('.touchops__commit') // HOP -> VIEW
    await sleep(800)
    if (!await store('s.viewing()')) return 'VIEW did not turn on'
    const during = await cam()
    const moved = before && during ? Math.hypot(...before.position.map((v, i) => v - during.position[i])) : 0
    if (moved > 0.5) return `camera moved ${moved.toFixed(2)} when VIEW turned on`
    return true
  })

  await flow('walk', async () => {
    await press('.touchops__commit') // VIEW -> WALK
    await sleep(1000)
    if (!await store('s.walking')) return 'WALK did not turn on'
    const n0 = await store('s.events.length')
    for (let i = 0; i < 5; i++) { await page.keyboard.press('w'); await sleep(120) }
    let warnedStraight = false
    const endStraight = Date.now() + 4000
    while (Date.now() < endStraight) { if (await page.locator('.syncwarn.is-on').count().then((n) => n > 0)) warnedStraight = true; await sleep(200) }
    if (!await waitFor(() => store(`s.events.length > ${n0}`), 90_000)) return 'no walk step landed'
    const afterStraight = await store('s.events.length') - n0
    // Rapid turns: each turn closes a segment, so three or more may queue.
    let warned = false
    await page.evaluate(async () => { const { useWalk } = await import('/src/store/useWalk.ts'); window.__maxBehind = 0; window.__unsubBehind?.(); window.__unsubBehind = useWalk.subscribe((w) => { window.__maxBehind = Math.max(window.__maxBehind, w.behind) }) })
    for (const k of ['w', 'a', 'w', 'd', 'w', 'a', 'w', 'd']) { await page.keyboard.press(k); await sleep(70); if (await page.locator('.syncwarn.is-on').count().then((n) => n > 0)) warned = true }
    for (let i = 0; i < 20 && !warned; i++) { if (await page.locator('.syncwarn.is-on').count().then((n) => n > 0)) warned = true; await sleep(150) }
    await waitFor(async () => (await mod('/src/store/useWalk.ts', 'm.useWalk.getState().behind')) === 0, 120_000, 500)
    // Space and C are up and down: each its own segment.
    const n2 = await store('s.events.length')
    await page.keyboard.press(' '); await sleep(900); await page.keyboard.press('c'); await sleep(900)
    await waitFor(async () => (await mod('/src/store/useWalk.ts', 'm.useWalk.getState().behind')) === 0 && (await store(`s.events.length >= ${n2} + 2`)), 120_000, 500)
    const upDown = await store('s.events.length') - n2
    await shot('walk-after')
    await press('.touchops__commit') // WALK -> HOP
    await sleep(1200)
    if (await store('s.walking')) return 'WALK did not turn off'
    const maxBehind = await page.evaluate(() => window.__maxBehind)
    const notes = [`max behind on rapid turns: ${maxBehind}`, `straight run of 5 presses made ${afterStraight} hop(s)`, `Space then C made ${upDown} hop(s)`, `warning on straight: ${warnedStraight}`, `warning on rapid turns: ${warned}`]
    if (warnedStraight) return `LOSING SYNC showed on a straight run (${notes.join('; ')})`
    if (upDown < 2) return `Space/C did not step (${notes.join('; ')})`
    console.log('   walk:', notes.join('; '))
    return true
  })

  await flow('scale-keys', async () => {
    await home()
    await page.keyboard.press('q'); await page.keyboard.press('q'); await sleep(300)
    if (await store('s.scaleExp') !== 2) return `Q twice gave 2^${await store('s.scaleExp')}`
    await press('.touchpad__key--cube'); await sleep(400)
    const cube = await store('s.scaleExp')
    await press('.touchpad__key--earth'); await sleep(400)
    const earth = await store('s.scaleExp')
    await press('.touchpad__hub'); await sleep(400)
    const hub = await store('s.scaleExp')
    if (cube !== 84 || earth !== 52 || hub !== 0) return `cube ${cube}, earth ${earth}, hub ${hub}`
    return true
  })

  // A port the loaded line holds: offline there are no kind 321 anchors, so
  // the line is the header blobs alone (to about block 950,000), and a newer
  // block's root lands on its raw coordinate by design.
  let port = { height: 971270, root: PORT_ROOT }
  await flow('C-port', async () => {
    await waitFor(async () => (await mod('/src/store/useHyperspace.ts', 'm.getStopIndex().size')) > 900_000, 240_000, 2000)
    port = await page.evaluate(async () => {
      const { getStopIndex } = await import('/src/store/useHyperspace.ts')
      const { stopAt, kindIsPort } = await import('/src/lib/hyperspace/compactIndex.ts')
      const idx = getStopIndex()
      for (let row = idx.size - 1; row >= 0; row--) if (kindIsPort(idx, row)) { const s = stopAt(idx, row); return { height: s.height, root: s.merkleRoot } }
      return null
    }) ?? port
    await page.goto(`${base}/C/${port.root}`, { waitUntil: 'domcontentloaded' })
    const h = port.height.toLocaleString('en-US')
    const re = new RegExp(`${h.replace(/,/g, ',?')} · port`, 'i')
    if (!await waitFor(async () => re.test(await text()), 140_000, 1000)) return `no "Block ${h} · port" within 140 s`
    return /merkle root read as a cyberspace coordinate/i.test(await text()) || 'port subtext missing'
  }, 400_000)

  await flow('goal-far-port', async () => {
    const g = page.locator('.goalchip')
    if (!await g.count()) return 'no GOAL button while viewing a port'
    await g.first().click(); await sleep(1500)
    const t = await page.locator('.goalbar').first().innerText().catch(() => '')
    return /Board at|ride|Walk there|Finding/i.test(t) || `goal chip said: ${t.slice(0, 120)}`
  })

  await flow('C-landfall', async () => {
    await page.goto(`${base}/C/${LANDFALL_ROOT}`, { waitUntil: 'domcontentloaded' })
    if (!await waitFor(async () => /900,?000 · landfall/i.test(await text()), 140_000, 1000)) return 'no "Block 900,000 · landfall" within 140 s'
    const g = page.locator('.goalchip')
    if (await g.count()) { await g.first().click(); await sleep(1500) }
    return true
  })

  await flow('C-prefix', async () => {
    await page.goto(`${base}/C/529d6e3`, { waitUntil: 'domcontentloaded' })
    return await waitFor(async () => /C\/529d6e3/i.test(await text()) || await page.evaluate(() => !!window.__store?.getState().focus), 30_000) || 'prefix view never set'
  })

  await flow('C-invalid', async () => {
    await page.goto(`${base}/C/zzzz-not-hex`, { waitUntil: 'domcontentloaded' })
    return await waitFor(async () => /Not a coordinate/i.test(await text()), 30_000) || 'no "Not a coordinate" toast'
  })

  await flow('return-and-near-goal', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await waitFor(() => page.locator('.touchops__commit').count().then((n) => n > 0), 60_000); await sleep(3000)
    for (let i = 0; i < 3; i++) { await page.keyboard.press('a'); await sleep(150) }
    const g = page.locator('.goalchip')
    if (!await g.count()) return 'no GOAL button with the cursor moved off the avatar'
    await g.first().click()
    let t = ''
    // Planned once the line has loaded (a reload restarts the sync).
    await waitFor(async () => /Walk there|Board at/i.test(t = await page.locator('.goalbar').first().innerText().catch(() => '')), 180_000, 1000)
    const clear = page.locator('.goalbar__clear'); if (await clear.count()) await clear.first().click()
    await press('.touchops__cancel'); await sleep(500)
    return /Walk there/i.test(t) || `near goal said: ${t.replace(/\s+/g, ' ').slice(0, 160)}`
  }, 300_000)

  await flow('spectate', async () => {
    await mod('/src/lib/spectator.ts', `m.spectate('${ARKINOX}')`)
    if (!await waitFor(() => store('!!s.spectate && s.spectate.status === "live" && s.spectate.events.length > 0'), 60_000)) return `spectate status: ${await store('s.spectate && s.spectate.status')}`
    const bar = await page.locator('.spectate__eye, .spectate').count()
    await st(() => window.__store.getState().endSpectate()); await sleep(800)
    return (bar > 0 && await store('s.spectate === null')) || 'no spectate bar, or END left it on'
  })

  await flow('person-card-xor', async () => {
    // CHAT is for where you stand: end the spectation first (it is disabled while spectating, by design).
    await page.keyboard.press('Escape'); await sleep(300)
    await st(() => { const s = window.__store.getState(); s.spectate && s.endSpectate() }); await sleep(800)
    await mod('/src/store/usePersonCard.ts', `m.usePersonCard.getState().open('${XOR}')`)
    if (!await waitFor(() => page.locator('.person').count().then((n) => n > 0), 15_000)) return 'card did not open'
    const t = await page.locator('.person').innerText()
    if (!/CHAT/.test(t)) return 'no CHAT on a stranger\'s agent card'
    if (/\bTALK\b/.test(t)) return 'TALK shown on someone else\'s agent'
    await page.locator('.person .secret__act', { hasText: 'CHAT' }).first().click()
    await sleep(800)
    const draft = await page.locator('.chat__input').inputValue().catch(() => '')
    if (!/^@\S+ /.test(draft)) return `CHAT did not prefill a tag (draft: "${draft}")`
    await page.locator('.chat__input').fill('')
    return true
  })

  await flow('person-card-own-agent', async () => {
    await st(() => { const s = window.__store.getState(); s.spectate && s.endSpectate() })
    await mod('/src/store/usePersonCard.ts', `m.usePersonCard.getState().open('${myAgent}')`)
    const ok = await waitFor(() => page.locator('.person__talk').count().then((n) => n > 0), 30_000, 500)
    if (!ok) return 'no TALK on my own agent\'s card'
    await page.locator('.person__talk').click(); await sleep(1000)
    const open = await page.evaluate(() => /TALK|STRATEGY|DM inbox/i.test(document.body.innerText))
    await page.keyboard.press('Escape'); await sleep(500)
    return open || 'TALK did not open the conversation'
  })

  await flow('chat-mention-picker', async () => {
    const chip = page.locator('.chatdock__chip', { hasText: 'CHAT' })
    if (await chip.count()) await chip.first().click()
    await sleep(600)
    const input = page.locator('.chat__input')
    if (!await input.count()) return 'chat input not found'
    await input.fill('@'); await sleep(600)
    const picker = await page.locator('.chat__picker').count()
    await input.fill(''); await page.keyboard.press('Escape'); await sleep(300)
    return picker > 0 || '@ did not open the mention picker'
  })

  const openMenu = async () => { if (!await page.locator('.identity__change').count()) { await page.locator('.hamburger-menu').click(); await sleep(700) } }
  const closeMenu = async () => { if (await page.locator('.identity__change').count()) { await page.locator('.hamburger-menu').click(); await sleep(500) } }

  await flow('shard-feed', async () => {
    await openMenu()
    await page.locator('.shards__feed').first().click(); await sleep(2500)
    const t = await text()
    const has = /DEPLOY AN INSTANCE/.test(t)
    await page.keyboard.press('Escape'); await sleep(500)
    return has || 'feed shows no DEPLOY AN INSTANCE (no objects listed?)'
  })

  await flow('deploy-shard-and-modal', async () => {
    const shardsHere = () => mod('/src/store/useShards.ts', 'm.useShards.getState().worldItems().filter((i) => i.type === "shard").length')
    // Counted before DEPLOY: the lined-up deploy's ghost is a world item too.
    const before = await shardsHere()
    await openMenu()
    await page.locator('.shards__feed').first().click(); await sleep(2500)
    const dep = page.locator('button', { hasText: 'DEPLOY AN INSTANCE' })
    if (!await dep.count()) return 'no DEPLOY AN INSTANCE in the feed'
    await dep.first().click(); await sleep(1500)
    await closeMenu()
    const place = page.locator('button', { hasText: 'HIDE (LOCAL)' })
    if (!await place.count()) return 'no HIDE (LOCAL) on the deploy bar after DEPLOY AN INSTANCE'
    await place.first().click()
    if (!await waitFor(async () => (await shardsHere()) > before, 90_000, 500)) return 'the shard was not placed'
    await sleep(1500)
    const key = await mod('/src/store/useShards.ts', 'm.useShards.getState().worldItems().filter((i) => i.type === "shard").map((i) => i.key).pop() ?? null')
    if (!key) return 'placed shard not in the world'
    await mod('/src/store/useShards.ts', `m.useShards.getState().selectSecret('${key}')`)
    if (!await waitFor(() => page.locator('.secret__spin canvas').count().then((n) => n > 0), 15_000)) return 'shard modal has no turning preview'
    await shot('shard-modal')
    await page.mouse.click(5, 5); await sleep(800)
    const st2 = await store('s.focus && s.focus.label')
    if (await page.locator('.secret__spin').count()) return 'modal did not close on a tap outside'
    // BUILD mode ends with the placement or stays: leave it either way.
    await st(() => { const s = window.__store.getState(); s.focus && s.clearFocus() })
    return true
  })

  await flow('chest-item-feed', async () => {
    await openMenu()
    await page.locator('button', { hasText: 'SEAL A CHEST' }).first().click(); await sleep(1000)
    const feed = page.locator('.chest__act', { hasText: 'ITEM FEED' })
    if (!await feed.count()) return 'no ITEM FEED button in chest compose'
    await feed.first().click(); await sleep(1500)
    const opened = await page.locator('.secrets__box').count()
    await page.keyboard.press('Escape'); await sleep(600)
    const closed = await page.locator('.modal .secrets__box').count() === 0
    const cancel = page.locator('.shards__compose button', { hasText: 'CANCEL' }); if (await cancel.count()) await cancel.first().click()
    if (!opened) return 'ITEM FEED picker did not open'
    return closed || 'Escape did not close the ITEM FEED picker (its search box has focus)'
  })

  await flow('forge-and-publish-confirm', async () => {
    await openMenu()
    await page.locator('button', { hasText: 'FORGE AN ITEM' }).first().click(); await sleep(1000)
    const name = page.locator('input[aria-label*="name" i]').first()
    if (!await name.count()) return 'forge form has no name input'
    await name.fill('Smoke Key'); await sleep(200)
    const submit = page.locator('button', { hasText: 'PLACE ITEM' })
    if (!await submit.count()) return 'no PLACE ITEM button'
    await submit.first().click(); await sleep(2000)
    // PLACE ITEM lines the item up in BUILD mode; PLACE at the build cursor hides it (LOCAL).
    await closeMenu()
    const place = page.locator('button', { hasText: 'HIDE (LOCAL)' })
    if (!await place.count()) return 'no HIDE (LOCAL) on the deploy bar after PLACE ITEM'
    await place.first().click(); await sleep(6000)
    await openMenu()
    const pub = page.locator('button', { hasText: /^PUBLISH$/ })
    if (!await pub.count()) return 'no PUBLISH on the forged item in ITEMS'
    await pub.first().click(); await sleep(800)
    const confirm = await page.locator('.modal').count()
    const cancel = page.locator('.modal button', { hasText: /CANCEL/i })
    if (await cancel.count()) await cancel.first().click()
    await sleep(400)
    const leaked = await store('s.live')
    return (confirm > 0 && leaked === false) || 'no confirm before publishing the item'
  })

  await flow('hyperspace-station-view', async () => {
    await openMenu()
    const v = page.locator('.hyper__btn--view')
    if (!await v.count()) return 'no VIEW STATION'
    await v.first().click(); await sleep(2500)
    await closeMenu()
    const order = await page.evaluate(() => [...document.querySelectorAll('.instruments__group')].map((g) => `${g.className.split('--')[1]}:${g.children.length}`).join(' '))
    const ret = page.locator('.hyperbar__end', { hasText: 'RETURN' })
    if (!await ret.count()) return `no RETURN while viewing the station (stack ${order})`
    await ret.first().click(); await sleep(800)
    return (await store('s.focus === null')) || 'RETURN left a focus behind'
  })

  await flow('chip-stack-order', async () => {
    await page.keyboard.press('a'); await press('.touchops__commit'); await sleep(800) // VIEW on
    const groups = await page.evaluate(() => [...document.querySelectorAll('.instruments__group')].map((g) => g.className.replace(/.*--/, '')))
    await press('.touchops__cancel'); await sleep(500)
    return groups.join(',') === 'return,status,toast' || `groups in order: ${groups.join(',')}`
  })

  await flow('notifications', async () => {
    await openMenu()
    await page.locator('.identity__notif').first().click(); await sleep(1200)
    const open = await page.locator('.notif').count()
    await page.keyboard.press('Escape'); await sleep(400)
    return open > 0 || 'notifications did not open'
  })

  await flow('login-modal-tap-outside', async () => {
    await openMenu()
    await page.locator('.identity__change', { hasText: 'CHANGE' }).first().click(); await sleep(1000)
    if (!await page.locator('.login').count()) return 'login modal did not open'
    const cursor0 = await store('JSON.stringify([String(s.cursor.x), String(s.cursor.y), String(s.cursor.z)])')
    await page.mouse.click(10, 300); await sleep(800)
    const still = await page.locator('.login').count()
    const cursor1 = await store('JSON.stringify([String(s.cursor.x), String(s.cursor.y), String(s.cursor.z)])')
    if (still) return 'login modal did not close on a tap outside'
    return cursor0 === cursor1 || 'the tap that closed the modal also moved the cursor'
  })

  console.log(device, 'relay stats', JSON.stringify(stats))
  await browser.close()
  return { results, stats }
}

const devices = which === 'both' ? ['phone', 'desktop'] : [which]
const all = []
const statsAll = {}
for (const d of devices) { const r = await runDevice(d); all.push(...r.results); statsAll[d] = r.stats }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), base, results: all, stats: statsAll }, null, 1))
const flows = [...new Set(all.map((r) => r.flow))]
const cell = (d, f) => { const r = all.find((x) => x.device === d && x.flow === f); return r ? (r.ok ? 'PASS' : 'FAIL') + (r.overlaps?.length ? ' (overlap)' : '') : '' }
const lines = [
  '# ONOSENDAI smoke test', '',
  `Run ${new Date().toISOString()} against ${base}. Offline: every relay is in-process (published to: nobody). Screenshots beside this file.`, '',
  `| Flow | ${devices.join(' | ')} | Notes |`, `|---|${devices.map(() => '---|').join('')}---|`,
  ...flows.map((f) => `| ${f} | ${devices.map((d) => cell(d, f)).join(' | ')} | ${all.filter((r) => r.flow === f && (r.note || r.overlaps?.length)).map((r) => `${r.device}: ${[r.note, r.overlaps?.length ? 'overlaps ' + r.overlaps.join(', ') : ''].filter(Boolean).join('; ')}`).join('<br>').replace(/\|/g, '/')} |`),
  '', `Relay frames (fake relay): ${JSON.stringify(statsAll)}`,
]
fs.writeFileSync(path.join(out, 'SMOKE-REPORT.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
