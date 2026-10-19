/**
 * glContext.ts: say so in the console when the main view's WebGL context is
 * lost, and when it comes back (2026-10-19). Cyberspace TV froze after half
 * an hour in Brave on Windows, picture stopped and music playing on, and
 * nothing said why. Three asks the browser to restore a lost context; this
 * only makes a loss visible, so the next freeze says whether it was one.
 */

/** Watch `canvas` for the loss and return of its context; the stop. */
export function watchContext(canvas: HTMLCanvasElement, name: string, log: Pick<Console, 'warn'> = console): () => void {
  const lost = (): void => log.warn(`[onosendai] WebGL context lost: ${name}, ${Math.round(performance.now() / 1000)} s after load`)
  const back = (): void => log.warn(`[onosendai] WebGL context restored: ${name}`)
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', back)
  return () => {
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', back)
  }
}
