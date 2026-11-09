/**
 * rateLimit.ts - what a relay's refusal says, in the words relays really
 * use. No imports, so a test that replaces lib/relay wholesale still gets
 * the real reading (store/useShardImport.ts).
 */

/**
 * A relay saying "too fast": NIP-01's "rate-limited:", and
 * relay.onosendai.tech's (grain) own "Rate limit exceeded for category:
 * regular" and "Global event rate limit exceeded". A refusal for now: the
 * socket is fine, and whoever sent waits and tries again.
 */
export const RATE_LIMITED = /^rate-limited:|^rate.?limit|rate limit exceeded|global event rate limit/i

/** Whether a publish failed because the relay said it came too fast. */
export function isRateLimited(reason: string): boolean {
  return RATE_LIMITED.test(reason)
}

/**
 * A relay saying the event is too big, in grain's words (config/setSizeLimit.go):
 * "Global event size limit exceeded", "Event size limit exceeded for kind
 * ...", "Content length limit exceeded". The same event will never be taken.
 */
export const TOO_BIG = /global event size limit exceeded|event size limit exceeded for kind|content length limit exceeded/i
