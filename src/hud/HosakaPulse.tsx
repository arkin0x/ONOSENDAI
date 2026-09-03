/**
 * HosakaPulse.tsx: the HOSAKA mark, breathing in the top right corner while
 * a job is under way. The job itself lives in the Cloud compute panel, which
 * on a phone is behind the menu; this is the one sign on the scene that
 * something is being computed for you elsewhere.
 */

import { jobInProgress } from '../lib/cloud'
import { useCyberspace } from '../store/useCyberspace'

export function HosakaPulse(): JSX.Element | null {
  const status = useCyberspace((s) => s.cloud.status)
  if (!jobInProgress(status)) return null
  return (
    <img
      className="hosaka-pulse"
      src="/hosaka-mark.png"
      alt="HOSAKA job in progress"
      role="status"
      width={424}
      height={437}
      decoding="async"
    />
  )
}
