import { useContext } from 'react'
import { GeolocationContext } from '../providers/GeolocationProvider'

export const useGeolocationData = () => {
  return useContext(GeolocationContext)
}
