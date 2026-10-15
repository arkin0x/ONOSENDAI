import { useEffect, useState } from 'react'

/**
 * The value once it has held still for `ms`: a debounce. The result equals
 * `value` only when the value has settled, so `settled === value` is the
 * test for "the timer has run out".
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}
