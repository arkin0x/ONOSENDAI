/**
 * sample.ts - deterministic identity sampling for the stop field.
 *
 * The field draws at most a budget of dots out of nearly a million stops.
 * Sampling by POSITION (every Nth row of the sorted index) re-dealt the
 * whole visible set every time the population grew or the perm re-sorted:
 * "every 15th" and "every 35th" are almost disjoint, and merges shift every
 * row's position anyway, so during sync the crust of Earth reshuffled
 * wholesale on each growth rebuild. Sampling by IDENTITY fixes the draw per
 * block: a height hashes to a priority, the smallest priorities are drawn,
 * and whether a given block is visible depends on nothing but itself and
 * the size of the crowd.
 *
 * Two properties carry the design:
 *
 *  - Deterministic: same stops in range, same dots. Every rebuild, every
 *    session, every client.
 *  - Nested: for populations P within P', drawn(P') INTERSECT P is a subset
 *    of drawn(P). Growing the line only ADDS dots (new blocks entering the
 *    budget) or evicts the largest-priority few at the margin; it never
 *    deals a fresh hand. Proof sketch: the prefilter threshold only
 *    tightens as the population grows, and any competitor that outranks a
 *    drawn block under the looser threshold also clears the tighter one,
 *    so a block's rank can only improve as the pool shrinks around it.
 *
 * Block positions are hash-uniform in space (the whole premise of the
 * line), so a height-keyed subset is as unbiased a spatial sample as the
 * old stride was.
 */

/**
 * 32-bit avalanche mix of a block height, murmur3-finalizer family. Heights
 * are sequential integers; the mix turns them into uniform priorities.
 */
export function hashHeight(height: number): number {
  let h = height >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x21f0aaad)
  h ^= h >>> 15
  h = Math.imul(h, 0x735a2d97)
  h ^= h >>> 15
  return h >>> 0
}

/**
 * The priority threshold admitting about `budget` of `population` uniform
 * hashes; 2^32 (admit everything) when the population already fits. Monotone
 * in the population, which is what makes the sample nested.
 */
export function sampleThreshold(population: number, budget: number): number {
  if (population <= budget) return 0x1_0000_0000
  return Math.ceil((budget / population) * 0x1_0000_0000)
}

/**
 * The exact drawn set: up to `budget` of the given heights, the ones whose
 * hashed priorities sort smallest (ties to the lower height, so the order is
 * total). Prefilters at twice the budget so the sort touches thousands of
 * candidates, not the whole population.
 */
export function drawnSet(heights: ArrayLike<number>, budget: number): Set<number> {
  const n = heights.length
  const t = sampleThreshold(n, budget * 2)
  const pre: number[] = []
  for (let i = 0; i < n; i++) {
    const h = heights[i]
    if (hashHeight(h) < t) pre.push(h)
  }
  if (pre.length > budget) {
    pre.sort((a, b) => hashHeight(a) - hashHeight(b) || a - b)
    pre.length = budget
  }
  return new Set(pre)
}
