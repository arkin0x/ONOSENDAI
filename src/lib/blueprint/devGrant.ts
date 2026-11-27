/**
 * devGrant.ts - a Compiler to test with, on preview builds only.
 *
 * Nobody starts with a Compiler: the only way to one is building its recipe
 * from real blocks and smashing it with a bare hand (owner, 2026-11-26). On
 * a Vercel preview deployment (VERCEL_ENV 'preview') and on localhost the owner wants to try it at once
 * (owner, 2026-11-27: "on the vercel preview we can start with the compiler
 * to try it out"), so there every identity starts with one, marked
 * 'granted' (lib/terrain/terrainDb.ts). `?compiler=0` turns the grant off on
 * this device (to try the bare-hand recipe), `?compiler=1` back on. On the
 * production host none of this is honoured, in any build: the grant is
 * never on there, and a granted Compiler is taken off the bar.
 */

const KEY = 'onosendai:compiler-grant'

/** The production hosts, where the grant is never on. */
const PRODUCTION_HOSTS = new Set(['onosendai.tech', 'www.onosendai.tech'])

/** Whether this page is on the production host. */
export function productionHost(): boolean {
  try { return PRODUCTION_HOSTS.has(location.hostname.toLowerCase()) } catch { return true }
}

/** Vercel's deployment environment for this build: 'preview', 'production', or '' off Vercel. */
export function vercelEnv(): string {
  try { const v = (import.meta.env as Record<string, unknown>).VITE_VERCEL_ENV; return typeof v === 'string' ? v : '' } catch { return '' }
}

/**
 * Whether this page may grant: a Vercel preview deployment, localhost, or a
 * dev server; never production. A production deployment also has a
 * *.vercel.app address, so the address alone is not enough: the build must
 * be a preview (review of #943, 2026-11-27).
 */
export function previewHost(): boolean {
  const env = vercelEnv()
  if (productionHost()) return false
  if (import.meta.env.DEV) return true
  try {
    const h = location.hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1') return true
    return h.endsWith('.vercel.app') && env === 'preview'
  } catch { return false }
}

function fromUrl(): void {
  if (!previewHost()) return
  try {
    const asked = new URLSearchParams(location.search).get('compiler')
    if (asked === '0') localStorage.setItem(KEY, '0')
    else if (asked === '1') localStorage.removeItem(KEY)
  } catch { /* no location or no storage: the grant stays as it is */ }
}
fromUrl()

/** Whether the identity on screen starts with a Compiler here: on preview hosts, unless this device switched it off. */
export function compilerGranted(): boolean {
  if (!previewHost()) return false
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}
