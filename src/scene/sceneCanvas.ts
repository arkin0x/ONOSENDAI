/**
 * sceneCanvas.ts - the main scene's canvas, told apart from every other canvas on the page (a blueprint's drawing, an
 * item's spinning model, a QR code): scene/Scene.tsx marks it with data-scene="main" when it is made, and TERRAIN's
 * pointer (terrain/TerrainView.tsx onScene) mines or places only on a press that lands on it.
 */

/** The data-scene value the main scene's canvas carries. */
export const SCENE_CANVAS = 'main'

/** Mark a canvas as the main scene's. */
export function markSceneCanvas(el: HTMLCanvasElement): void {
  el.dataset.scene = SCENE_CANVAS
}
