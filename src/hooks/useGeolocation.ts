import { useState, useEffect } from 'react'

export const useGeolocation = (trigger: boolean) => {
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [error, setError] = useState<GeolocationPositionError | null>(null)

  useEffect(() => {
    const geo = navigator.geolocation
    if (!geo) {
      setError({
        code: 2,
        message: 'Geolocation is not supported',
      } as GeolocationPositionError)
      return
    }

    let watcher: number
    if (trigger) {
      watcher = geo.watchPosition(setPosition,setError)
    }

    if (error) console.warn(error)

    return () => geo.clearWatch(watcher)
  }, [trigger, error])

  return [ position ]
}
