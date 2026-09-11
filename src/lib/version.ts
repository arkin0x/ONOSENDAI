/**
 * The build's version: `2.YYYYMMDD.N.PR`.
 *
 *   2         the major, this is v2
 *   YYYYMMDD  the day the PR being built was merged into v2, in arkinox's
 *             day (America/Chicago), which is the day the merge commit
 *             already carries in its own timestamp
 *   N         how many PRs had been merged into v2 that day, this one
 *             included, counted in merge order
 *   PR        the number of the PR being built
 *
 * Read left to right as numbers it only ever goes up: a new day beats any
 * count, and within a day every merge adds one to N. The PR number is the
 * tail and may go down within a day when a lower-numbered PR merges later;
 * N has already gone up by then. Rebuilding an older commit gives that
 * commit's own number again, since N counts only the merges up to it.
 *
 * Where the pieces come from at build time: the PR number from the commit
 * message of the commit being built (a squash merge ends its subject in
 * "(#N)"), which Vercel hands over as VERCEL_GIT_COMMIT_MESSAGE and a local
 * build reads from git; the merge days from GitHub's list of closed PRs on
 * v2, since a Vercel build has no git history to count from. A build that
 * is not a merge (a branch, a dev server) shows the version of the newest
 * merge, which is what production is running. No data at all shows
 * "unversioned build" rather than a number that would read as one.
 */
export interface MergedPr {
  number: number
  /** ISO 8601 merge time, as GitHub reports it (UTC). */
  mergedAt: string
}

export const MAJOR = 2
export const VERSION_ZONE = 'America/Chicago'
export const UNVERSIONED = 'unversioned build'

/** The PR number a squash-merge subject ends with, or null: "Title (#134)" gives 134. */
export function headPrOf(message: string | undefined | null): number | null {
  const first = (message ?? '').split('\n')[0]
  const m = /\(#(\d+)\)\s*$/.exec(first)
  return m ? Number(m[1]) : null
}

/** The calendar day of an instant in the zone, as YYYYMMDD. */
export function dayOf(iso: string, zone: string = VERSION_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso)).replace(/-/g, '')
}

/**
 * The version for `head` given the merged PRs. A head that is not among
 * them, or no head at all, is versioned as the newest merge. No merges at
 * all gives UNVERSIONED.
 */
export function versionOf(merged: MergedPr[], head: number | null, zone: string = VERSION_ZONE): string {
  const inOrder = merged
    .filter((p) => Number.isFinite(Date.parse(p.mergedAt)))
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
  if (inOrder.length === 0) return UNVERSIONED
  const at = (head !== null && inOrder.find((p) => p.number === head)) || inOrder[inOrder.length - 1]
  const day = dayOf(at.mergedAt, zone)
  const t = Date.parse(at.mergedAt)
  const n = inOrder.filter((p) => dayOf(p.mergedAt, zone) === day && Date.parse(p.mergedAt) <= t).length
  return `${MAJOR}.${day}.${n}.${at.number}`
}

const PULLS_URL = 'https://api.github.com/repos/arkin0x/ONOSENDAI/pulls?state=closed&base=v2&sort=updated&direction=desc&per_page=100'

/** GitHub's closed PRs on v2 that were merged, newest first as listed. */
export async function fetchMergedPrs(fetchFn: typeof fetch = fetch, token?: string, timeoutMs = 8000): Promise<MergedPr[]> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'onosendai-build' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetchFn(PULLS_URL, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`GitHub pulls: HTTP ${res.status}`)
  const list = (await res.json()) as Array<{ number: number; merged_at: string | null }>
  return list.filter((p) => p.merged_at !== null).map((p) => ({ number: p.number, mergedAt: p.merged_at as string }))
}

/**
 * The version for this build, from the environment and GitHub. Never
 * throws: a build with no network is still a build.
 */
export async function resolveVersion(env: Record<string, string | undefined>, message: string | null, fetchFn: typeof fetch = fetch): Promise<string> {
  if (env.VITE_ONOSENDAI_VERSION) return env.VITE_ONOSENDAI_VERSION
  try {
    const merged = await fetchMergedPrs(fetchFn, env.GITHUB_TOKEN)
    return versionOf(merged, headPrOf(message))
  } catch (err) {
    console.warn(`[version] ${err instanceof Error ? err.message : String(err)}; building as "${UNVERSIONED}"`)
    return UNVERSIONED
  }
}
