/**
 * HosakaPulse.tsx: the HOSAKA mark, breathing just above the menu button
 * while a job is under way, the width of that button and on its axis. The
 * job itself lives in the Cloud compute panel, so App mounts this only while
 * the panels are closed: it is the one sign on the scene that something is
 * being computed for you elsewhere.
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
      width={308}
      height={334}
      decoding="async"
    />
  )
}
