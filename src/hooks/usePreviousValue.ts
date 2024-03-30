import { useEffect, useRef } from "react"

/**
 * Set up a variable that always holds the previous value of the input value, with `undefined` as the initial value.
 * 
 * Here's how it works with react's render flow:
 * - The first time the component renders, `usePrevious` is called with the initial value of `value`. `useRef()` creates a ref object with `.current` set to `undefined`, and `useEffect` schedules a function to run after the render. The hook returns `undefined`, because that's the current value of `ref.current`.
 * - After the render, the function scheduled by `useEffect` runs, setting `ref.current` to the initial value of `value`.
 * - The next time the component renders, `usePrevious` is called with the new value of `value`. `useRef()` returns the same ref object as before, so `ref.current` is still the initial value of `value`. `useEffect` schedules a function to run after the render. The hook returns the initial value of `value`, because that's the current value of `ref.current`.
 * - After the render, the function scheduled by `useEffect` runs, setting `ref.current` to the new value of `value`.
 * 
 * This process repeats for each render. The value returned by the hook is always one step behind the current value, so it's the previous value.
 * 
 * This is how `usePrevious` stores the previous value of a variable.
 * 
 * @param value any
 * @returns previous value any
 * @example const prevValue = usePreviousValue(myValue)
 */
export function usePreviousValue<T>(value: T): T|undefined {
  const ref = useRef<T|undefined>()
  useEffect(() => {
    ref.current = value
  })
  return ref.current
}