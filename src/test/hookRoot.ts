/**
 * hookRoot.ts - a hook mounted with no DOM, for tests: a React renderer that
 * draws nothing (react-reconciler, already here for @react-three/fiber), so a
 * hook's effects, state and re-renders run as they do in the app. The
 * component the hook lives in returns null, so no host element is ever made.
 */

import { createElement, type FunctionComponent, type ReactElement } from 'react'
import Reconciler from 'react-reconciler'
import { DefaultEventPriority } from 'react-reconciler/constants.js'

const none = (): null => null
const noop = (): void => {}
const renderer = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  createInstance: () => { throw new Error('hookRoot draws nothing') },
  createTextInstance: () => { throw new Error('hookRoot draws nothing') },
  appendInitialChild: noop,
  appendChild: noop,
  appendChildToContainer: noop,
  insertBefore: noop,
  insertInContainerBefore: noop,
  removeChild: noop,
  removeChildFromContainer: noop,
  clearContainer: noop,
  finalizeInitialChildren: () => false,
  prepareUpdate: none,
  commitUpdate: noop,
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

/** Let React run what it scheduled: effects, then the renders their state changes asked for. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Mount `hook(props)`, inside `wrap` when given (a context provider); `current()` is its latest result, `render` gives it new props, `unmount` ends it. */
export function mountHook<P, R>(hook: (props: P) => R, props: P, wrap: (el: ReactElement) => ReactElement = (el) => el): { current: () => R; renders: () => number; render: (p: P) => Promise<void>; unmount: () => Promise<void> } {
  let latest: R
  let count = 0
  const Host: FunctionComponent<{ p: P }> = ({ p }) => { latest = hook(p); count++; return null }
  const container = renderer.createContainer({}, 0, null, false, null, '', (e: unknown) => { throw e }, null)
  renderer.updateContainer(wrap(createElement(Host, { p: props })), container, null, null)
  return {
    current: () => latest,
    renders: () => count,
    render: async (p) => { renderer.updateContainer(wrap(createElement(Host, { p })), container, null, null); await settle() },
    unmount: async () => { renderer.updateContainer(null, container, null, null); await settle() },
  }
}
