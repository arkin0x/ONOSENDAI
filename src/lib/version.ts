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

/**
 * The app's simple version, the one people see (arkinox, 2026-11-12): bumped
 * by one each time an UPGRADE ANNOUNCEMENT goes out (2.1, 2.2, ... 2.10),
 * and the `d` of that announcement (lib/tv/announceFeed). Its source is
 * package.json `version`, kept three parts so npm takes it ("2.1.0"); a
 * patch of 0 is not written ("2.1"), any other is ("2.1.1", a hotfix). The
 * build stamp above (2.YYYYMMDD.N.PR) stays, for debugging.
 *
 * Null for a version that is not plain numbers (a prerelease such as
 * "2.0.0-mvp.0"): no simple version rather than a wrong one.
 */
export function simpleVersion(pkgVersion: string | null | undefined): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((pkgVersion ?? '').trim())
  if (!m) return null
  const [major, minor, patch] = m.slice(1).map(Number)
  return patch === 0 ? `${major}.${minor}` : `${major}.${minor}.${patch}`
}

/** Plain numbers with dots, two to four parts: what a simple version looks like. */
export const SIMPLE_VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){1,3}$/

/**
 * Two simple versions compared part by part as numbers, a missing part as 0
 * (2.10 is above 2.9; 2.1 and 2.1.0 are the same): negative when `a` is
 * lower, positive when higher, 0 when the same.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The higher of two simple versions; either may be missing, or not a simple version (it is then passed over). */
export function higherVersion(a: string | null | undefined, b: string | null | undefined): string | null {
  const ok = (v: string | null | undefined): v is string => typeof v === 'string' && SIMPLE_VERSION_RE.test(v)
  if (!ok(a)) return ok(b) ? b : null
  if (!ok(b)) return a
  return compareVersions(b, a) > 0 ? b : a
}
