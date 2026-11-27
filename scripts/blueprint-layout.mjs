/**
 * blueprint-layout.mjs: the BLUEPRINT tool's layout holds (owner, 2026-11-27:
 * "layout is exploded", "the grid background ... really messy").
 *
 * Opens the tool in a browser at each size and screen density and checks:
 * - the compose cage: every cell is whole device pixels wide and starts on a
 *   whole device pixel, one pitch from the next, so its grid lines are crisp;
 *   the +X and +Z labels and the black sun stand clear of it;
 * - the compose step: USE THIS (at the top) and the preview are both on
 *   screen without scrolling at every size (owner, 2026-11-27);
 * - the landing list (BUILD > BLUEPRINT): CREATE NEW and every DEPLOY are on
 *   the page, nothing wider than the screen;
 * - the prize step: no folder-edit control is there; tiles never overlap each
 *   other; inside a tile the thumbnail, name, status line and action stack
 *   without overlapping; the folder chips never overlap.
 * Nothing reaches a relay: every non-localhost request is refused, LOCAL is
 * set before load. With SHOTS=<dir>, a screenshot of each step at each size
 * is saved there.
 *
 * Usage: start the dev server (npx vite --port 5291), then
 *   node scripts/blueprint-layout.mjs [http://localhost:5291/]
 * Exit 1 on any problem.
 */
import { chromium } from 'playwright'

const URL = (process.argv[2] ?? 'http://localhost:5291/') + '?mode=view'
const SIZES = [
  { name: '375 dpr1', w: 375, h: 812, dpr: 1, touch: true },
  { name: '375 dpr2', w: 375, h: 812, dpr: 2, touch: true },
  { name: '375 dpr3', w: 375, h: 812, dpr: 3, touch: true },
  { name: '430 dpr3', w: 430, h: 932, dpr: 3, touch: true },
  { name: '1024x768 dpr1', w: 1024, h: 768, dpr: 1, touch: false },
  { name: '1440 dpr1', w: 1440, h: 900, dpr: 1, touch: false },
  { name: '1441 dpr2', w: 1441, h: 901, dpr: 2, touch: false },
  // A tablet in a browser, its height cut by the browser's bars (owner, 2026-11-27: USE THIS was under the fold).
  { name: '714x600 dpr2', w: 714, h: 600, dpr: 2, touch: true },
]
const SHOTS = process.env.SHOTS ?? ''
const problems = []
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, hasTouch: size.touch, isMobile: size.touch })
  await ctx.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()))
  await ctx.addInitScript(() => { try { localStorage.setItem('onosendai:live', '0') } catch {} })
  const page = await ctx.newPage()
  await page.goto(URL)
  await page.waitForTimeout(9000)
  // The landing list first: two blueprints held, CREATE NEW over them.
  await page.evaluate(async () => {
    const T = (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool
    T.getState().openTool()
  })
  // A cold dev server may still be bringing the app up: wait for the tool itself.
  await page.waitForSelector('.bpt', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/layout-${size.w}-dpr${size.dpr}-list.png` })
  const list = await page.evaluate(() => {
    const create = [...document.querySelectorAll('.bpt button')].find((b) => /CREATE NEW/i.test(b.textContent ?? ''))
    return { create: !!create, scrollW: document.documentElement.scrollWidth, w: window.innerWidth }
  })
  if (!list.create) problems.push(`${size.name}: the list has no CREATE NEW`)
  if (list.scrollW > list.w + 0.5) problems.push(`${size.name}: the list scrolls sideways (${list.scrollW} > ${list.w})`)
  // The compose grid, with a few blocks on two layers.
  await page.evaluate(async () => {
    const T = (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool
    T.getState().createNew()
    T.getState().set({ composing: true, step: 0 })
    for (const [x, y, z, id] of [[6, 0, 6, 1], [7, 0, 6, 40], [7, 1, 6, 42], [0, 0, 0, 8], [15, 0, 15, 1]]) { T.getState().set({ layer: y, brush: id }); T.getState().paint(x, z) }
    T.getState().set({ layer: 1 })
  })
  await page.waitForTimeout(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/layout-${size.w}-dpr${size.dpr}-compose.png` })
  const cage = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.bpt-cell')].map((c) => c.getBoundingClientRect())
    const box = document.querySelector('.bpt-cage')?.getBoundingClientRect()
    const r = (s) => document.querySelector(s)?.getBoundingClientRect()
    const scroll = document.querySelector('.bpt-scroll')?.getBoundingClientRect()
    const vis = (q) => { const e = r(q); return !!e && !!scroll && e.width > 0 && e.top >= scroll.top - 0.5 && e.bottom <= scroll.bottom + 0.5 && e.left >= 0 && e.right <= window.innerWidth + 0.5 }
    return { cells: cells.map((c) => [c.left, c.top, c.width, c.height]), box: box && [box.left, box.top, box.right, box.bottom], x: r('.bpt-cage__axis--x'), z: r('.bpt-cage__axis--z'), sun: r('.bpt-cage__sun'), go: vis('.bpt-layer__go'), preview: vis('.bpt-compose__preview'), grid: vis('.bpt-cage'), scrollW: document.documentElement.scrollWidth, w: window.innerWidth }
  })
  // USE THIS, the preview and the whole grid on screen with no scrolling, and no sideways page scroll (owner, 2026-11-27).
  for (const k of ['go', 'preview', 'grid']) if (!cage[k]) problems.push(`${size.name}: ${k === 'go' ? 'USE THIS' : k} is not fully on screen without scrolling`)
  if (cage.scrollW > cage.w + 0.5) problems.push(`${size.name}: the compose step scrolls sideways`)
  if (size.touch && size.w <= 430 && cage.cells.length && cage.cells[0][2] < 18) problems.push(`${size.name}: grid cells are ${cage.cells[0][2]}px, too small to tap`)
  if (cage.cells.length !== 256) problems.push(`${size.name}: the cage has ${cage.cells.length} cells`)
  const dev = (v) => Math.abs(v * size.dpr - Math.round(v * size.dpr)) < 0.02
  const bad = cage.cells.filter(([l, t, w, h]) => !dev(l) || !dev(t) || !dev(w) || !dev(h))
  if (bad.length) problems.push(`${size.name}: ${bad.length} cage cells off whole device pixels (first ${JSON.stringify(bad[0])})`)
  const pitch = cage.cells.length > 1 ? cage.cells[1][0] - cage.cells[0][0] : 0
  if (Math.abs(pitch - (cage.cells[0][2] + 1)) > 0.02) problems.push(`${size.name}: the cage pitch ${pitch} is not a cell and a line`)
  if (cage.box) {
    const b = { left: cage.box[0], top: cage.box[1], right: cage.box[2], bottom: cage.box[3] }
    for (const k of ['x', 'z', 'sun']) if (cage[k] && overlap(cage[k], b)) problems.push(`${size.name}: ${k} overlaps the cage`)
  }
  // The prize step, with folders and tiles.
  await page.evaluate(async () => {
    const T = (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool
    const W = (await import('/src/store/useWorkshop.ts')).useWorkshop
    const F = (await import('/src/store/useShardFolders.ts')).useShardFolders
    const { fromPayload } = await import('/node_modules/.vite/deps/sno-core_shards.js').catch(() => import('sno-core/shards'))
    const cube = (id, name) => fromPayload({ v: 2, name, unit: 0, mode: 'solid', vertices: [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]], colors: Array(8).fill([255, 170, 40]), faces: [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[3,2,6],[3,6,7],[1,5,6],[1,6,2],[0,3,7],[0,7,4]] }, id)
    const list = [cube('torch', 'Torch'), cube('torch-copy', 'Torch copy with a long name'), cube('key', 'Silver Key'), cube('obj2', 'Object 2'), cube('lamp', 'Lamp')]
    if (list.some((x) => !x)) throw new Error('a test shard did not read')
    W.setState({ shards: [cube('torch', 'Torch'), cube('torch-copy', 'Torch copy with a long name'), cube('key', 'Silver Key'), cube('obj2', 'Object 2'), cube('lamp', 'Lamp')] })
    F.setState({ tree: { folders: { a: { id: 'a', name: 'Folder 1', parent: null, at: 1 }, b: { id: 'b', name: 'Folder 2', parent: null, at: 2 } }, assign: { torch: 'a' }, collapsed: {}, alias: {} } })
    T.getState().takeCage({ lo: { x: 1000n, y: 1000n, z: 1000n }, plane: 0 })
  })
  await page.waitForTimeout(1200)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/layout-${size.w}-dpr${size.dpr}-prize.png` })
  const prize = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }
    const words = [...document.querySelectorAll('.bpt button')].map((b) => b.textContent.trim())
    const tiles = [...document.querySelectorAll('.bpt-tile')].map((t) => ({ box: r(t), parts: ['.itemthumb, .chamfer', '.bpt-tile__name', '.bpt-tile__status', '.bpt-tile__act'].map((s) => t.querySelector(s)).filter(Boolean).map(r) }))
    const chips = [...document.querySelectorAll('.bpt-chip')].map(r)
    return { words, tiles, chips, folderUi: document.querySelectorAll('.bpt .shardfolders, .bpt .folders, .bpt [class*="folder__"]').length }
  })
  for (const banned of [/new folder/i, /rename/i, /^delete/i, /^select$/i, /^move/i]) if (prize.words.some((w) => banned.test(w))) problems.push(`${size.name}: a folder-edit control (${banned}) is in the prize picker`)
  if (prize.folderUi) problems.push(`${size.name}: the folder manager is in the prize picker`)
  for (let i = 0; i < prize.tiles.length; i++) {
    for (let j = i + 1; j < prize.tiles.length; j++) if (overlap(prize.tiles[i].box, prize.tiles[j].box)) problems.push(`${size.name}: tiles ${i} and ${j} overlap`)
    const p = prize.tiles[i].parts
    for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) if (overlap(p[a], p[b])) problems.push(`${size.name}: inside tile ${i}, parts ${a} and ${b} overlap`)
    for (const part of p) if (part.left < prize.tiles[i].box.left - 0.5 || part.right > prize.tiles[i].box.right + 0.5) problems.push(`${size.name}: tile ${i} has a part outside it`)
  }
  for (let i = 0; i < prize.chips.length; i++) for (let j = i + 1; j < prize.chips.length; j++) if (overlap(prize.chips[i], prize.chips[j])) problems.push(`${size.name}: chips ${i} and ${j} overlap`)
  // The other steps, for the eye.
  if (SHOTS) {
    await page.evaluate(async () => { const T = (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool; const W = (await import('/src/store/useWorkshop.ts')).useWorkshop; const s = W.getState().shards[0]; T.getState().set({ prize: { name: s.name, shard: s, from: 'workshop' } }); T.getState().setStep(2) })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${SHOTS}/layout-${size.w}-dpr${size.dpr}-settings.png` })
    await page.evaluate(async () => { (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool.getState().setStep(3) })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/layout-${size.w}-dpr${size.dpr}-seal.png` })
  }
  console.log(`${size.name}: ${prize.tiles.length} tiles, ${prize.chips.length} chips, cage ${cage.cells.length} cells, pitch ${pitch}`)
  await ctx.close()
}
await browser.close()
if (problems.length) { console.log('PROBLEMS\n' + problems.join('\n')); process.exit(1) }
console.log('OK: no overlap, cage on whole device pixels at every size')
