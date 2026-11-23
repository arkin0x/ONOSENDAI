/**
 * terrainUnknown.ts: the K value that means "outside the universe", shared by
 * the terrain worker and the page.
 *
 * It lives here and not in workers/terrain.worker.ts because importing a
 * worker module for a value runs that module on the page too, and a worker
 * module sets `self.onmessage`. On the page `self` is the window, so the
 * terrain handler answered almost every window message with a window message of its
 * own: one message from anything (an extension, an embed) started a loop of
 * about 30,000 messages a second that never stopped, hidden tab or not, and
 * the garbage it made froze the page in long GCs (arkinox, 2026-11-18: 7 GB in
 * 30 seconds; the loop had run since 2026-08-10). The page imports no worker
 * module for a value now (lib/__tests__/workerImports.test.ts).
 */

/** Outside the universe. A renderer cannot tell this from "not yet known". */
export const UNKNOWN = 255
