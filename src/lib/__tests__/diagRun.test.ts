/**
 * The capture run for real against a page made of fakes: the report comes from a
 * machine we cannot reach, so a report that throws is a report we never get. What
 * goes in here is what must not come out.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../relay', () => ({ getPool: () => ({ relays: new Map([['r', { connected: true, openSubs: new Map([['s', {}]]) }]]) }) }))
vi.mock('../../hooks/useEscape', () => ({ modalUp: () => false }))
vi.mock('../../store/useCyberspace', () => ({ useCyberspace: { getState: () => ({ walking: false, spectate: null, focus: null }) } }))
vi.mock('../../store/useHyperspace', () => ({ useHyperspace: { getState: () => ({ viewOwned: false }) } }))
vi.mock('../../store/useThumbs', () => ({ useThumbs: { getState: () => ({ order: [], queue: [] }) } }))
vi.mock('../../store/useTv', () => ({ useTv: { getState: () => ({ on: false }) } }))
vi.mock('../../store/useWorkshop', () => ({ useWorkshop: { getState: () => ({ open: false }) } }))

const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'
const COORD = 'cfe6b74cab677b52d850ac659d54266a3a4d7bb48270234d2fec836881d0a5f7'
const PLAINTEXT = 'meet me at the old port'
const SRC = `https://images.example/avatars/${COORD}.png`

class FakeStorage {
  map = new Map<string, string>()
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
}

const local = new FakeStorage()
const session = new FakeStorage()
const observers = new Map<string, (entries: unknown[]) => void>()
const appended: Array<{ textContent?: string; addEventListener?: unknown }> = []
const tasks: Array<() => void> = []
let reported = ''
let WS: { prototype: { send: (d: unknown) => void } }
const sent: unknown[] = []

function element(tag: string): Record<string, unknown> {
  const listeners = new Map<string, (e: unknown) => void>()
  const el: Record<string, unknown> = {
    tagName: tag, style: {}, textContent: '', children: [] as unknown[],
    append(...c: unknown[]) { (el.children as unknown[]).push(...c) },
    addEventListener(n: string, f: (e: unknown) => void) { listeners.set(n, f) },
    blur: vi.fn(),
    tap() { listeners.get('click')?.({ stopPropagation() {} }) },
  }
  return el
}

beforeAll(async () => {
  local.setItem('onosendai:nsec', NSEC)
  local.setItem('onosendai:chat', PLAINTEXT)
  session.setItem('onosendai:diag:last', '{"diag":1,"from":"the load before"}')
  class Observer {
    constructor(private f: (l: { getEntries(): unknown[] }) => void) {}
    observe(o: { type: string }): void { observers.set(o.type, (entries) => this.f({ getEntries: () => entries })) }
  }
  class Sock {
    readyState = 1
    addEventListener(): void {}
    send(d: unknown): void { sent.push(d) }
  }
  WS = Sock as never
  ;(Sock as unknown as { OPEN: number }).OPEN = 1
  class Canvas { getContext(): null { return null } }
  class GL { drawElements(): void {} drawArrays(): void {} drawElementsInstanced(): void {} drawArraysInstanced(): void {} bindBuffer(): void {} bindTexture(): void {} activeTexture(): void {} bindRenderbuffer(): void {} }
  class FakeWorker { terminate(): void {} }
  const win = {
    WebGL2RenderingContext: GL, Worker: FakeWorker,
    setTimeout: (f: () => void) => { tasks.push(f); return 1 }, setInterval: () => 2,
    devicePixelRatio: 1.5, innerWidth: 1000, innerHeight: 600, crossOriginIsolated: false,
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('HTMLCanvasElement', Canvas)
  vi.stubGlobal('WebSocket', Sock)
  vi.stubGlobal('PerformanceObserver', Observer)
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('screen', { width: 2560, height: 1440 })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('location', { pathname: `/C/${COORD}`, href: `https://www.onosendai.tech/C/${COORD}?diag=1`, replace: vi.fn() })
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0', hardwareConcurrency: 8, brave: {}, storage: { estimate: async () => ({ usage: 1, quota: 2, usageDetails: { indexedDB: 1 } }) }, clipboard: { writeText: async (s: string) => { reported = s } } })
  vi.stubGlobal('document', {
    visibilityState: 'visible', hasFocus: () => true, body: { append: (e: { textContent?: string }) => appended.push(e) },
    querySelectorAll: () => [], getElementsByTagName: () => [], addEventListener() {}, createElement: element,
  })
  vi.stubGlobal('__ONOSENDAI_BUILD__', 'ded106e6e0bd1234567890')
  vi.stubGlobal('__ONOSENDAI_VERSION__', '2.test')
  const { startDiag } = await import('../diag')
  startDiag()
})

afterAll(() => vi.unstubAllGlobals())

describe('the capture, running', () => {
  const report = (): Record<string, unknown> => JSON.parse((window as unknown as { __diag: { report(): string } }).__diag.report())

  it('makes a report whose rows line up with its columns', () => {
    const r = report() as { columns: string[]; fine: unknown[][]; uiStates: string[] }
    expect(r.fine.length).toBeGreaterThan(0)
    for (const row of r.fine) expect(row.length).toBe(r.columns.length)
    const ui = r.fine[0][r.columns.indexOf('ui')] as number
    expect(typeof r.uiStates[ui]).toBe('string')
  })

  it('says how far to trust its numbers under Brave', () => {
    const r = report() as { env: { brave: boolean; farbled: string[]; heap: string; route: string } }
    expect(r.env.brave).toBe(true)
    expect(r.env.farbled).toEqual(['cores', 'memGb', 'screen'])
    expect(['precise', 'bucketed', 'absent']).toContain(r.env.heap)
    expect(r.env.route).toBe('C')
  })

  it('counts the workers made and let go', () => {
    const before = report() as { columns: string[]; fine: unknown[][]; workers: { made: number; ended: number } }
    const W = window.Worker as unknown as new () => { terminate(): void }
    const a = new W(), b = new W()
    a.terminate()
    void b
    const after = report() as { workers: { made: number; ended: number } }
    expect(after.workers.made - before.workers.made).toBe(2)
    expect(after.workers.ended - before.workers.ended).toBe(1)
  })

  it('keeps none of what passes through it', () => {
    ;(WS.prototype.send as (this: unknown, d: unknown) => void).call(new (WS as unknown as new () => unknown)(), `["EVENT",{"content":"${PLAINTEXT}","id":"${COORD}"}]`)
    expect(sent).toHaveLength(1)
    observers.get('long-animation-frame')?.([{
      duration: 900,
      scripts: [{ duration: 800, invoker: `IMG[src=${SRC}].onerror`, sourceFunctionName: NSEC, sourceCharPosition: 12, sourceURL: `https://www.onosendai.tech/assets/index-abc.js` }],
    }])
    const text = JSON.stringify(report())
    for (const secret of [NSEC, COORD, PLAINTEXT, 'images.example', 'wss:', 'https:']) expect(text).not.toContain(secret)
    expect(text).toContain('IMG.onerror')
  })

  it('offers what the last load left, without writing over it', () => {
    expect(session.getItem('onosendai:diag:found')).toContain('the load before')
    expect(session.getItem('onosendai:diag:last') ?? '').not.toContain('the load before')
  })

  it('the chip copies, says so after its buttons, and gives the focus back', async () => {
    const chip = appended[0] as unknown as { children: Array<{ textContent: string; tap(): void; blur: ReturnType<typeof vi.fn> }> }
    const labels = chip.children.map((c) => c.textContent)
    expect(labels).toEqual(['COPY', 'SAVE', 'LAST', 'OFF', 'DIAG'])
    chip.children[0].tap()
    expect(chip.children[0].blur).toHaveBeenCalled()
    await vi.waitFor(() => expect(reported).not.toBe(''))
    expect(JSON.parse(reported).diag).toBe(1)
    await vi.waitFor(() => expect(chip.children[4].textContent).toMatch(/^COPIED/))
  })

  it('offers the last report back on a tap', async () => {
    const chip = appended[0] as unknown as { children: Array<{ tap(): void }> }
    chip.children[2].tap()
    await vi.waitFor(() => expect(reported).toContain('the load before'))
  })

  it('turns off, and goes back to the same address without the flag', () => {
    session.setItem('onosendai:diag', '1')
    const chip = appended[0] as unknown as { children: Array<{ tap(): void }> }
    chip.children[3].tap()
    expect(session.getItem('onosendai:diag')).toBeNull()
    const replaced = (location.replace as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL
    expect(replaced.searchParams.has('diag')).toBe(false)
  })
})
