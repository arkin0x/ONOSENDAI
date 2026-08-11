/**
 * cameraPose.ts — the main camera's orientation, shared across canvases.
 *
 * The compass lives in its own Canvas and has to mirror the main view. It used
 * to copy the `view` quaternion, which worked when the world group carried that
 * same rotation and the camera cancelled it. With free orbit the camera can be
 * anywhere and `view` no longer describes where you are looking, so the compass
 * needs the real thing.
 *
 * A shared mutable quaternion rather than store state: this updates every frame
 * and nothing should re-render because of it.
 */

import { Quaternion } from 'three'

export const cameraPose = new Quaternion()
