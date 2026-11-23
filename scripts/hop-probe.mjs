/**
 * hop-probe.mjs: the tutorial's first HOP, measured in a real browser, LOCAL
 * (owner, 2026-11-12: "When I do the first hop I never see the animation it
 * seems to just freeze for a second and then I appear at the next location").
 *
 * A fresh generated key opens /?tutorial=1, taps FIND IT, waits for the box
 * step to line the cursor up, then taps COMMIT and records, against that tap:
 *   - every animation frame (a rAF loop of its own) and every long task;
 *   - the store's transitions (proof status, chain length, position, anchor)
 *     and the hop's own marks (performance.mark 'hop:*', when the build has them);
 *   - the avatar's drawn glide (lib/travel travelOffset) on every frame, so a
 *     glide that finished before a frame was painted shows as none drawn;
 *   - when the chest is discovered, and a CPU profile of the window.
 * Every socket is the in-process relay of scripts/smoke-lib.mjs: nothing is
 * published anywhere, and LOCAL is set before the app loads.
 *
 * Usage: node scripts/hop-probe.mjs <dev url> <out dir> <tag> [phone|desktop]
 * Env: VIDEO=1 records a webm instead of profiling (the profiler slows frames).
 * FRAMES=<n> instead steps the page's clock (CDP virtual time) 33 ms at a
 * time from the COMMIT and saves a screenshot at each step, n of them: the
 * hop as it looks at 30 frames a second whatever this machine's software
 * renderer manages. Virtual time does not count how long a task runs, so a
 * stall does not show in these frames; the timings above are the measure.
 */
import fs from 'node:fs'
import path from 'node:path'
import { launch } from './smoke-lib.mjs'

const [url, out, tag, form = 'phone'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const video = process.env.VIDEO === '1'
const stepFrames = Number(process.env.FRAMES ?? 0)

const { browser, ctx, page, errors } = await launch({ phone: form === 'phone', url, video: video ? out : null, mint: true })
await page.addInitScript(() => {
  const w = window
  w.__probe = { frames: [], long: [], marks: [], glide: [], links: [] }
  // Every shader program linked, and how long its first status read (the sync wait on the link) took.
  for (const C of [w.WebGL2RenderingContext, w.WebGLRenderingContext]) {
    if (!C) continue
    const link = C.prototype.linkProgram, info = C.prototype.getProgramParameter, log = C.prototype.getProgramInfoLog
    const pend = new WeakMap(), names = new WeakMap()
    C.prototype.linkProgram = function (prog) {
      pend.set(prog, performance.now())
      try {
        const src = (this.getAttachedShaders(prog) ?? []).map((sh) => this.getShaderSource(sh) ?? '').join('\n')
        names.set(prog, (src.match(/#define SHADER_NAME (\S+)/) ?? [])[1] ?? ([...src.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]).filter((u) => !/^(modelMatrix|modelViewMatrix|projectionMatrix|viewMatrix|normalMatrix|cameraPosition|isOrthographic)$/.test(u)).slice(0, 6).join(',') || 'unnamed'))
      } catch {}
      return link.call(this, prog)
    }
    const timed = (fn) => function (prog, ...rest) {
      const at = pend.get(prog); const t = performance.now(); const r = fn.call(this, prog, ...rest)
      if (at !== undefined) { pend.delete(prog); w.__probe.links.push([t, performance.now() - t, names.get(prog)]) }
      return r
    }
    C.prototype.getProgramParameter = timed(info); C.prototype.getProgramInfoLog = timed(log)
  }
  const tick = (t) => { w.__probe.frames.push(t); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__probe.long.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
  } catch {}
})
const ev = (s) => page.evaluate(s)
const t0 = Date.now()
await page.goto(`${url}/?tutorial=1`)
await page.waitForFunction(() => !!window.__store, null, { timeout: 60_000 })
// The welcome card, then FIND IT.
await page.locator('.tutorial-card__go').first().waitFor({ timeout: 60_000 })
await sleep(1500)
await page.locator('.tutorial-card__go').first().click()
// The box step lines the cursor up once the stage is in.
await page.waitForFunction(() => {
  const s = window.__store.getState()
  return s.cursor.x !== s.position.x || s.cursor.y !== s.position.y || s.cursor.z !== s.position.z
}, null, { timeout: 90_000 })
console.log('aimed after', Date.now() - t0, 'ms')
// Let boot settle: the commit is measured against a quiet page.
await sleep(Number(process.env.SETTLE ?? 8000))

await ev(`(async () => {
  const P = window.__probe
  const travel = await import('/src/lib/travel.ts')
  // The chest by what it is, not by importing the director: a second copy of
  // a module the dev server has reloaded would register the tutorial twice.
  const isChest = (h) => h && h.type === 'chest' && /tutorial/i.test(h.chest?.name ?? '')
  const s0 = window.__store.getState()
  P.from = s0.position; P.to = s0.cursor; P.events0 = s0.events.length
  window.__store.subscribe((s, p) => {
    const t = performance.now()
    if (s.proof.status !== p.proof.status) P.marks.push([t, 'proof:' + s.proof.status + (s.proof.message ? ' (' + s.proof.message.slice(0, 40) + ')' : '')])
    if (s.events.length !== p.events.length) P.marks.push([t, 'events:' + s.events.length])
    if (s.position !== p.position) P.marks.push([t, 'position'])
    if (s.anchor !== p.anchor) P.marks.push([t, 'anchor'])
  })
  window.__shards.subscribe((s, p) => {
    if (s.discovered === p.discovered || P.marks.some((m) => m[1] === 'chest:discovered')) return
    if (Object.entries(s.discovered).some(([id, h]) => isChest(h) && !p.discovered[id])) P.marks.push([performance.now(), 'chest:discovered'])
  })
  const glide = (t) => { P.glide.push([t, travel.travelOffset.length()]); requestAnimationFrame(glide) }
  requestAnimationFrame(glide)
})()`)

if (stepFrames > 0) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
  await ev(`(() => { const b = document.querySelector('.touchops__commit:not(.is-hop):not(.is-view):not(.is-walk):not(.is-build)'); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); else window.__store.getState().commit() })()`)
  const dir = path.join(out, `frames-${tag}`)
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < stepFrames; i++) {
    const expired = new Promise((r) => cdp.once('Emulation.virtualTimeBudgetExpired', r))
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 33 })
    await expired
    // Workers (the proof) run on real time: give them a moment while the page's clock waits.
    await sleep(Number(process.env.FRAME_WAIT ?? 60))
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(data, 'base64'))
  }
  await browser.close()
  console.log('frames in', dir)
  process.exit(0)
}

let cdp = null
if (!video) {
  cdp = await ctx.newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
}
const commitAt = await ev(`(() => {
  const b = document.querySelector('.touchops__commit:not(.is-hop):not(.is-view):not(.is-walk):not(.is-build)')
  const t = performance.now()
  window.__probe.commitAt = t
  if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  else window.__store.getState().commit()
  window.__probe.button = !!b
  return t
})()`)
// Until the chest is found and a few seconds after (or 30 s).
await page.waitForFunction(() => window.__probe.marks.some((m) => m[1] === 'chest:discovered'), null, { timeout: 30_000 }).catch(() => console.log('chest not discovered in 30 s'))
await sleep(3000)
let profile = null
if (cdp) ({ profile } = await cdp.send('Profiler.stop'))

const P = await ev(`(() => {
  const P = { ...window.__probe }
  const big = (p) => p && { x: String(p.x), y: String(p.y), z: String(p.z) }
  P.from = big(P.from); P.to = big(P.to)
  const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('hop:')).map((m) => [m.startTime, m.name])
  const s = window.__store.getState()
  return { ...P, appMarks: marks, landed: big(s.position), events1: s.events.length }
})()`)
await page.screenshot({ path: path.join(out, `hop-anim-${tag}-end.png`) })
const vpath = video ? await page.video()?.path() : null
await ctx.close()
await browser.close()

// ---- Report ----
const rel = (t) => Math.round(t - commitAt)
const win = [commitAt - 50, commitAt + 30_000]
const frames = P.frames.filter((t) => t >= commitAt && t <= win[1])
const gaps = frames.slice(1).map((t, i) => [frames[i], t - frames[i]])
const marks = [...P.marks, ...P.appMarks].filter(([t]) => t >= win[0]).sort((a, b) => a[0] - b[0])
const at = (name) => marks.find((m) => m[1].startsWith(name))?.[0]
const landedAt = at('anchor') ?? at('position')
const chestAt = at('chest:discovered')
const glideFrames = P.glide.filter(([t, d]) => t >= commitAt && d > 1e-6)
const glideStart = glideFrames[0]?.[0]
const glideEnd = glideFrames[glideFrames.length - 1]?.[0]
const typical = (() => { const pre = P.frames.filter((t) => t < commitAt).slice(-120); const d = pre.slice(1).map((t, i) => t - pre[i]).sort((a, b) => a - b); return d[Math.floor(d.length / 2)] ?? 16.7 })()
const inHop = (a, b) => gaps.filter(([t, d]) => t + d >= a && t <= b)
const dropped = (list) => list.reduce((n, [, d]) => n + Math.max(0, Math.round(d / typical) - 1), 0)
const longest = (list) => list.reduce((m, [, d]) => Math.max(m, d), 0)

const summary = {
  tag, form, button: P.button, from: P.from, to: P.to, landed: P.landed, events: [P.events0, P.events1],
  typicalFrameMs: +typical.toFixed(1),
  commitToLandMs: landedAt ? rel(landedAt) : null,
  commitToGlideFirstDrawnMs: glideStart ? rel(glideStart) : null,
  glideFramesDrawn: glideFrames.length,
  glideDrawnSpanMs: glideStart ? Math.round(glideEnd - glideStart) : 0,
  firstFrameAfterLandMs: landedAt ? Math.round((frames.find((t) => t > landedAt) ?? NaN) - landedAt) : null,
  longestFrameMs: Math.round(longest(gaps)),
  longestFrameLandToPlus2sMs: landedAt ? Math.round(longest(inHop(landedAt, landedAt + 2000))) : null,
  framesDroppedLandToPlus2s: landedAt ? dropped(inHop(landedAt, landedAt + 2000)) : null,
  commitToChestDiscoveredMs: chestAt ? rel(chestAt) : null,
  programsLinkedAfterCommit: P.links.filter(([t]) => t >= commitAt).length,
  programLinkWaitMs: Math.round(P.links.filter(([t]) => t >= commitAt).reduce((n, [, d]) => n + d, 0)),
  programLinks: P.links.filter(([t]) => t >= commitAt).map(([t, d, n]) => [rel(t), Math.round(d), n]),
  programsBefore: P.links.filter(([t]) => t < commitAt).map(([t, d, n]) => [Math.round(t), Math.round(d), n]),
  programsLinkedBeforeCommit: P.links.filter(([t]) => t < commitAt).length,
  longTasks: P.long.filter(([s]) => s >= win[0]).map(([s, d]) => [rel(s), Math.round(d)]),
  marks: marks.map(([t, n]) => [rel(t), n]),
  bigGaps: gaps.filter(([, d]) => d > Math.max(50, typical * 3)).map(([t, d]) => [rel(t), Math.round(d)]),
  errors: errors.slice(0, 8),
  video: vpath,
}

// Who held the main thread in each long task: self time by function, from the CPU profile.
if (profile) {
  fs.writeFileSync(path.join(out, `hop-${tag}.cpuprofile`), JSON.stringify(profile))
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const times = []
  let t = profile.startTime
  for (const d of profile.timeDeltas) { t += d; times.push(t) }
  const appFrame = (id) => {
    // The innermost frame in our own source, with its callers' chain of our frames (up to 4).
    const chain = []
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const cf = nodes.get(cur).callFrame
      if (/\/src\//.test(cf.url)) chain.push(`${cf.functionName || '(anon)'}@${cf.url.split('/src/')[1].split('?')[0]}:${cf.lineNumber + 1}`)
      if (chain.length >= 4) break
    }
    return chain.join(' < ') || '(no app frame)'
  }
  const selfName = (id) => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'}${cf.url ? '@' + cf.url.split('/').pop().split('?')[0] + ':' + (cf.lineNumber + 1) : ''}` }
  const total = new Map()
  const buckets = new Map()
  const startT = times[0]
  profile.samples.forEach((id, i) => {
    const name = nodes.get(id).callFrame.functionName
    if (name === '(idle)' || name === '(program)' || name === '(garbage collector)') {
      if (name === '(garbage collector)') total.set('(gc)', (total.get('(gc)') ?? 0) + (profile.timeDeltas[i] ?? 0))
      return
    }
    const key = appFrame(id) + ' :: ' + selfName(id)
    const dt = profile.timeDeltas[i + 1] ?? 0
    total.set(key, (total.get(key) ?? 0) + dt)
    const bucket = Math.floor((times[i] - startT) / 250_000) * 250
    const bm = buckets.get(bucket) ?? new Map()
    const k2 = appFrame(id)
    bm.set(k2, (bm.get(k2) ?? 0) + dt)
    buckets.set(bucket, bm)
  })
  summary.topSelf = [...total].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, us]) => [Math.round(us / 1000), k])
  summary.buckets250ms = [...buckets].sort((a, b) => a[0] - b[0]).map(([b, m]) => {
    const busy = [...m.values()].reduce((x, y) => x + y, 0)
    return [b, Math.round(busy / 1000), [...m].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, us]) => `${Math.round(us / 1000)}ms ${k}`)]
  }).filter(([, busy]) => busy > 20)
}
fs.writeFileSync(path.join(out, `hop-${tag}.json`), JSON.stringify(summary, null, 1))
console.log(JSON.stringify({ ...summary, topSelf: summary.topSelf?.slice(0, 25), buckets250ms: summary.buckets250ms }, null, 1))
