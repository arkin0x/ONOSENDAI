/**
 * keepPrograms.ts: a renderer keeps every shader program it compiles for as
 * long as the page is open (2026-10-20).
 *
 * Three frees a program when the last material using it is disposed, and
 * compiles it again the next time a material needs it. Cyberspace TV unmounts
 * the tape's avatars, its finds and the panel's turning shard at a cut and
 * mounts the next shot's: the same few programs were thrown away and compiled
 * again, cut after cut. Compiling stops the main thread until the driver is
 * done, and Direct3D, under Chrome on Windows, is slow at it (arkinox,
 * 2026-10-20: /tv and the main view chug on his Windows laptop, his phone is
 * smooth). Measured offline, three runs of 180 s of /tv: 24 to 32 programs
 * compiled from 13 to 18 sources, 8.0 to 12.4 s of main thread spent
 * compiling again what had been compiled before. The feed's pictures, one
 * shard after another on one canvas (scene/ThumbStage), linked 90 programs
 * for 40 pictures.
 *
 * A program is kept by counting one more user of it than three does, so its
 * count never reaches zero. There are few of them, one for each kind of
 * material and the options it is drawn with, and they are small. KEEP_MAX
 * bounds them anyway: past it, programs are freed as three frees them.
 *
 * A ShaderMaterial needs one more thing. Three tells its programs apart by a
 * number it gives the material's source, and it forgets that number when the
 * last material with the source is disposed: the next one gets a new number,
 * so a new program, and the kept one is never used again. The shards' point
 * discs (scene/pointDisc) were compiled this way at every shard on TV. So for
 * each ShaderMaterial source a renderer draws, it also keeps a copy of the
 * material, never disposed, which holds the number. The copy is made ready
 * where the original was just drawn, with the same options, so it uses the
 * original's program and compiles nothing. Its uniforms are left out, so it
 * holds on to no texture or data.
 */

import { Line, LineLoop, LineSegments, Material, Mesh, Points, Sprite, type Camera, type Object3D, type Scene, type ShaderMaterial, type WebGLRenderer } from 'three'

/** At most this many programs kept on one renderer. Measured: at most 20 on /tv, all of it. */
export const KEEP_MAX = 96

/** What keep() needs of a three WebGLProgram: its count of users. */
export interface Counted { usedTimes: number }

/**
 * Takes one use of every program in `programs` not yet in `kept`, while
 * fewer than KEEP_MAX are kept; returns how many are kept.
 */
export function keep(programs: readonly Counted[], kept: Set<Counted>): number {
  for (const p of programs) {
    if (kept.size >= KEEP_MAX) break
    if (kept.has(p)) continue
    p.usedTimes++
    kept.add(p)
  }
  return kept.size
}

/** Fragment sources by vertex source: the ShaderMaterial sources a renderer holds a copy for. */
export type Sources = Map<string, Set<string>>

/**
 * Something of the same kind as `o`, on the same geometry, drawing `m`: what
 * three reads to choose a program, the same as for `o`. Null for the kinds
 * whose program depends on more than that (instanced, skinned, batched).
 */
export function standIn(o: Object3D, m: Material): Object3D | null {
  const k = o as Object3D & Partial<Record<'isInstancedMesh' | 'isSkinnedMesh' | 'isBatchedMesh' | 'isPoints' | 'isLineSegments' | 'isLineLoop' | 'isLine' | 'isSprite' | 'isMesh', boolean>> & { geometry?: Mesh['geometry'] }
  if (k.isInstancedMesh || k.isSkinnedMesh || k.isBatchedMesh) return null
  if (k.isSprite) return new Sprite(m as never)
  if (k.isPoints) return new Points(k.geometry, m)
  if (k.isLineSegments) return new LineSegments(k.geometry, m)
  if (k.isLineLoop) return new LineLoop(k.geometry, m)
  if (k.isLine) return new Line(k.geometry, m)
  if (k.isMesh) return new Mesh(k.geometry, m)
  return null
}

/**
 * Whether a copy of `s` takes the original's program. Not for one with lights,
 * whose copy three would wire the lights into (its uniforms are left out),
 * nor for one with its own compile hook or key, which a copy does not carry
 * (Material.copy), so it would compile a program of its own. None of these is
 * in the app; they are left to three, as before.
 */
export function copyable(s: ShaderMaterial): boolean {
  return !s.lights &&
    s.onBeforeCompile === Material.prototype.onBeforeCompile &&
    s.customProgramCacheKey === Material.prototype.customProgramCacheKey
}

/**
 * For each ShaderMaterial in `scene` drawn with a kept program, and with a
 * source not in `sources`, makes a copy ready with `gl` and keeps it, never
 * disposed. `drawn` says whether a material's program is one of the kept.
 * Called at the end of a render of `scene`, so the copy is made ready under
 * the same render target and lights as the original was drawn.
 */
export function keepSources(gl: WebGLRenderer, scene: Scene, camera: Camera, sources: Sources, drawn: (m: Material) => boolean): void {
  scene.traverse((o) => {
    const ms = (o as { material?: Material | Material[] }).material
    if (!ms) return
    for (const m of Array.isArray(ms) ? ms : [ms]) {
      const s = m as ShaderMaterial
      if (!s.isShaderMaterial || !copyable(s)) continue
      const fragments = sources.get(s.vertexShader)
      if (fragments?.has(s.fragmentShader)) continue
      if (!drawn(m)) continue
      // Only a source a copy can stand in for counts as kept: one first seen
      // on an instanced mesh is kept when it is drawn on something plainer.
      const o2 = standIn(o, s)
      if (!o2) continue
      if (fragments) fragments.add(s.fragmentShader)
      else sources.set(s.vertexShader, new Set([s.fragmentShader]))
      try {
        const copy = s.clone()
        copy.uniforms = {}
        copy.uniformsGroups = []
        ;(o2 as Mesh).material = copy
        const before = gl.info.programs?.length ?? 0
        gl.compile(o2, camera, scene)
        // The copy is meant to take the original's program. If it made one of
        // its own, what three reads to choose a program has changed under
        // this (a three upgrade, say), and the copy only adds a program.
        if (import.meta.env.DEV && (gl.info.programs?.length ?? 0) > before) {
          console.warn('[onosendai] keepPrograms: the copy of', s.name || s.type, 'compiled a program of its own')
        }
      } catch (e) {
        // Never a reason to lose a frame. The source is not tried again; at
        // worst it is compiled again later, as before.
        console.warn('[onosendai] keepPrograms: could not keep a copy of', s.name || s.type, e)
      }
    }
  })
}

/**
 * Keeps the programs `gl` compiles while it draws `scene`, the scene of an
 * R3F canvas. Checked after each render of it, so a program is kept in the
 * frame that first used it, before anything mounted in it can unmount.
 */
/** Three's own shader-error readback: on in development, off once built. */
export function checkShaderErrorsInDevOnly(gl: WebGLRenderer): void {
  gl.debug.checkShaderErrors = import.meta.env.DEV
}

export function keepPrograms(gl: WebGLRenderer, scene: Scene): void {
  // A program's first use reads its compile and link logs back from the
  // driver (gl.getShaderInfoLog x2, getProgramInfoLog, getProgramParameter):
  // three's own check for a shader that failed to compile. The read stops
  // the main thread until the driver answers, and on Direct3D (ANGLE, the
  // Windows backend Chrome and Brave draw through) that can run past a
  // second for one program, the same slow compiler this file was written to
  // spare repeat calls to (arkinox, 2026-10-23: freezes navigating the
  // world, where flying somewhere new keeps meeting shard combinations their
  // shaders have not been linked for yet). Built code has already shipped
  // with its shaders checked; development keeps the check, so a broken one
  // is still caught and printed.
  checkShaderErrorsInDevOnly(gl)
  // Programs from before a lost context are gone, and three makes new ones.
  let kept = new Set<Counted>()
  let sources: Sources = new Map()
  let list: unknown = null
  const drawn = (m: Material): boolean => kept.has((gl.properties.get(m) as { currentProgram?: Counted }).currentProgram as Counted)
  const after = scene.onAfterRender
  scene.onAfterRender = function (this: Scene, renderer, s, camera, geometry, material, group) {
    after.call(this, renderer, s, camera, geometry, material, group)
    const programs = gl.info.programs as unknown as Counted[] | null
    if (!programs) return
    if (programs !== list) { list = programs; kept = new Set(); sources = new Map() }
    const before = kept.size
    if (keep(programs, kept) > before) keepSources(gl, scene, camera, sources, drawn)
  }
}
