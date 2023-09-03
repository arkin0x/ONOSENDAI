import React, { Dispatch, SetStateAction }  from 'react'
import { Marker, useMap } from 'react-map-gl'
import { FollowTarget } from '../src/types/Follow'
import '../scss/Me.scss'
import { useGeolocationData } from '../src/hooks/useGeolocationData'

type MeProps = {
  setFollow: Dispatch<SetStateAction<FollowTarget>>
}

const validGeolocation = ( position: GeolocationPosition | null) => {
  if (position?.coords && position.coords.longitude && position.coords.latitude) {
    return true
  }
  return false
}

export const Me: React.FC<MeProps> = ({ setFollow }) => {

  const { position } = useGeolocationData()

  const {current: map} = useMap()

  const emoji = "😀"
  const userStyle = {
    backgroundColor: '#00AEEF'
  }

  const handleFollow = () => {
    if (map && position) {
      map.flyTo({
        center: [position?.coords.longitude, position?.coords.latitude],
        zoom: 16,
        duration: 1000,
      })
      map.once('moveend', () => setFollow("USER"))
    }
  }

  if (validGeolocation(position)) {
    return (
      <Marker longitude={position?.coords.longitude} latitude={position?.coords.latitude} anchor={'center'} offset={[-15.5,-15.5]}>
        <div id="me" className="component-useremoji" onClick={handleFollow}>
          <div className='color-ring' style={userStyle}>
            <span role='img'>{emoji}</span>
          </div>
        </div>
      </Marker>
    )
  } else {
    return null
  }
}