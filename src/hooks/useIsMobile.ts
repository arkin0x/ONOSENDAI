import { useEffect, useState } from 'react'

/**
 * True when the layout has to stack rather than sit in columns.
 *
 * 1100, not 768. The name says phone but the question is really whether there is
 * room for two 300px panel columns AND a usable gap between them, and below
 * about 1100 there is not: the controls end up on top of the compass. A narrow
 * desktop window wants the same treatment a phone does.
 *
 * It also has to agree with the stylesheet. This was 768 while the media queries
 * were 900, so between those widths the CSS stacked the panels while React still
 * thought it was a desktop.
 */
export function useIsMobile(breakpoint = 1100): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}
