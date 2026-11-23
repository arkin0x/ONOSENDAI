/**
 * tvOn.ts: whether TV is on, kept by store/useTv and read by store/useCeremony
 * (releasePending), which cannot import useTv without a module cycle. A
 * module with no imports of its own, so either side can load first.
 */
let on = false

/** Whether TV is on, as useTv last said. */
export function tvIsOn(): boolean {
  return on
}

/** useTv's word on whether TV is on. */
export function setTvOn(value: boolean): void {
  on = value
}
