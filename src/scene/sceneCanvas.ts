/**
 * sceneCanvas.ts - the scene's canvas, told apart from every other canvas on the page (a blueprint's drawing, an
 * item's spinning model, a QR code): scene/Scene.tsx marks the main scene's with data-scene="main" when it is made,
 * game/GameView.tsx its own with "game". TERRAIN's pointer (terrain/TerrainView.tsx onScene) mines or places only on a
 * press on the main scene's; a tap that folds the controls (hooks/useCanvasTap.ts) is one on either.
 */

/** The data-scene value the main scene's canvas carries. */
export const SCENE_CANVAS = 'main'

/** The data-scene value a game's own canvas carries. */
export const GAME_CANVAS = 'game'

/** Mark a canvas as a scene's: the main scene's unless said otherwise. */
export function markSceneCanvas(el: HTMLCanvasElement, which: typeof SCENE_CANVAS | typeof GAME_CANVAS = SCENE_CANVAS): void {
  el.dataset.scene = which
}

/** Whether an element is a scene's canvas (marked by markSceneCanvas), and not any other canvas on the page. */
export function isSceneCanvas(el: { tagName?: string; dataset?: DOMStringMap | Record<string, string | undefined> } | null | undefined): boolean {
  return el?.tagName === 'CANVAS' && (el.dataset?.scene === SCENE_CANVAS || el.dataset?.scene === GAME_CANVAS)
}
