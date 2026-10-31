/**
 * elementRoot.ts - components mounted with no DOM, for tests that click: a
 * React renderer (react-reconciler, as hookRoot.ts) whose host elements are
 * plain records of their type, props and children, so effects, state and
 * re-renders run as in the app and a test presses a button's real onClick.
 */

import type { ReactElement } from 'react'
import Reconciler from 'react-reconciler'
import { DefaultEventPriority } from 'react-reconciler/constants.js'

/** One host element, as a test reads it. */
export interface Host {
  type: string
  props: Record<string, unknown>
  children: Array<Host | string>
}

type Parent = { children: Array<Host | string> }
const none = (): null => null
const noop = (): void => {}
const add = (p: Parent, c: Host | string): void => { remove(p, c); p.children.push(c) }
const remove = (p: Parent, c: Host | string): void => { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1) }
const before = (p: Parent, c: Host | string, at: Host | string): void => { remove(p, c); p.children.splice(p.children.indexOf(at), 0, c) }
/** A text instance is a record too, so an update can write it: read back through textOf. */
const text = (s: string): Host => ({ type: '#text', props: { text: s }, children: [] })

const renderer = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  createInstance: (type: string, props: Record<string, unknown>): Host => ({ type, props, children: [] }),
  createTextInstance: text,
  appendInitialChild: add,
  appendChild: add,
  appendChildToContainer: add,
  insertBefore: before,
  insertInContainerBefore: before,
  removeChild: remove,
  removeChildFromContainer: remove,
  clearContainer: (p: Parent) => { p.children.length = 0 },
  finalizeInitialChildren: () => false,
  prepareUpdate: () => true,
  commitUpdate: (h: Host, _u: unknown, _t: string, _o: unknown, next: Record<string, unknown>) => { h.props = next },
  commitTextUpdate: (h: Host, _o: string, next: string) => { h.props = { text: next } },
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (c: object) => c,
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: none,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: none,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: none,
  detachDeletedInstance: noop,
} as never)

/** All the words under an element. */
export function textOf(h: Host | string): string {
  if (typeof h === 'string') return h
  if (h.type === '#text') return String(h.props.text)
  return h.children.map(textOf).join('')
}

function walk(h: Host | string, out: Host[]): void {
  if (typeof h === 'string') return
  out.push(h)
  for (const c of h.children) walk(c, out)
}

export interface Mounted {
  /** Every host element now on screen. */
  all: () => Host[]
  /** Every button whose words hold `words`. */
  buttons: (words: string | RegExp) => Host[]
  /** Press the one button that says this, as a tap does; throws when there is none, or it is disabled. */
  press: (words: string | RegExp) => Promise<void>
  /** Whether any words on screen hold this. */
  says: (words: string) => boolean
  unmount: () => Promise<void>
}

/** Let React run what it scheduled, and what a press awaited. */
export async function settled(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 1))
}

export async function mount(el: ReactElement): Promise<Mounted> {
  const root: Parent = { children: [] }
  const container = renderer.createContainer(root, 0, null, false, null, '', (e: unknown) => { throw e }, null)
  renderer.updateContainer(el, container, null, null)
  await settled()
  const all = (): Host[] => { const out: Host[] = []; for (const c of root.children) walk(c, out); return out }
  const buttons = (words: string | RegExp): Host[] => all().filter((h) => h.type === 'button' && (typeof words === 'string' ? textOf(h).includes(words) : words.test(textOf(h))))
  return {
    all,
    buttons,
    press: async (words) => {
      const [b] = buttons(words)
      if (!b) throw new Error(`no button says ${String(words)}; on screen: ${all().filter((h) => h.type === 'button').map(textOf).join(' | ')}`)
      if (b.props.disabled) throw new Error(`the button ${textOf(b)} is disabled`)
      ;(b.props.onClick as () => void)()
      await settled()
    },
    says: (words) => root.children.map(textOf).join(' ').includes(words),
    unmount: async () => { renderer.updateContainer(null, container, null, null); await settled() },
  }
}
