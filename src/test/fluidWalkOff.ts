/**
 * fluidWalkOff.ts: every test file starts with fluid WALK off
 * (store/fluidSwitch.ts), so the walk tests check the step WALK exactly as
 * it was. A fluid test switches it on itself (useFluidWalk.setState).
 * A global, not an import: a setup file must not load the app's modules
 * before a test file's own mocks.
 */
;(globalThis as { __ONOSENDAI_FLUID_DEFAULT__?: boolean }).__ONOSENDAI_FLUID_DEFAULT__ = false
