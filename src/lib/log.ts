/**
 * log.ts — timestamped console output.
 *
 * Every line carries milliseconds since the document's time origin, so a
 * pasted console log reads as a timeline: dispatch, arrival and geometry
 * rebuild can be lined up against each other without inferring order.
 *
 * Main thread only. A worker has its own time origin, so a timestamp logged
 * inside one is not comparable with these; workers report durations through
 * their response instead and the dispatcher prints them on this clock.
 */

export function tlog(...args: unknown[]): void {
  console.log(`${performance.now().toFixed(1).padStart(9)}ms`, ...args)
}
