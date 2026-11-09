/**
 * radialFog.ts: the scene fogs by straight-line distance from the camera, not
 * by depth along its line of sight (review of #635, S2b).
 *
 * three fogs by view-space depth (fog_vertex: vFogDepth = -mvPosition.z), so
 * a thing at the screen's edge fogs less than one straight ahead at the same
 * distance, and the fog shifts as the camera turns. The scene's layers cull
 * by straight-line distance (a sphere of CULL_REACH about the render origin,
 * scene/fog.ts), so at the edges a thing on the cull sphere was still a fifth
 * to a quarter visible when it popped. Fogging by the same distance makes the
 * bound exact (fogFar) and keeps the fog still while the camera turns.
 *
 * One chunk, replaced on import, before any material compiles: main.tsx
 * imports this first, and Scene.tsx imports it too. Every fogged material in
 * the scene is one of three's own (the headlamp's patch keeps three's fog
 * includes), so all of them take it; the custom shaders (the point field, the
 * walls) do not fog at all. Cyberspace TV's and WALK's fog distances are the
 * same numbers as before, now measured straight out.
 */

import { ShaderChunk } from 'three'

/** The replacement: the fragment's straight-line distance from the camera. */
export const RADIAL_FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG

	vFogDepth = length( mvPosition.xyz );

#endif
`

// In development only, ?depthfog keeps three's own, for shooting one against the other.
const keepDepth = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('depthfog')
if (!keepDepth) ShaderChunk.fog_vertex = RADIAL_FOG_VERTEX
