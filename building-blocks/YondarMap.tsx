import { useState, useContext } from 'react'
import { Me } from './Me'
import { MapPlaces } from './MapPlaces'
import { Cursor } from './Cursor'
import Map, { ViewState } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useGeolocationData } from '../src/hooks/useGeolocationData'
import { FollowTarget } from '../src/types/Follow'
import { ModalContextType } from "../src/types/ModalType"
import { ModalContext } from "../src/providers/ModalProvider"

type YondarMapProps = {
  children?: React.ReactNode
}

export const YondarMap = ({ children }: YondarMapProps) => {
  const [longitude, setLongitude] = useState<number>(-80)
  const [latitude, setLatitude] = useState<number>(0)
  const {position, setCursorPosition} = useGeolocationData()
  const [zoom, setZoom] = useState<number>(1)
  const [follow, setFollow] = useState<FollowTarget>(null)
  const {modal} = useContext<ModalContextType>(ModalContext)

  function setViewState(viewState: ViewState) {
    // unlock map, we moved the map by interaction
    setFollow(null)
    setLongitude(viewState.longitude)
    setLatitude(viewState.latitude)
    setZoom(viewState.zoom)
  }

  function handleClick(event: mapboxgl.MapLayerMouseEvent) {
    if ((event.originalEvent?.target as HTMLElement)?.tagName === "CANVAS") {
      // we touched the map. Place the cursor.
      if (modal?.placeForm === true) {
        // if the place form is open, don't move the cursor
        // close the place form
        modal.setPlaceForm(false)
      } else { 
        setCursorPosition(event.lngLat)
      }
    }
  }

  const mapLongitude = position && follow === "USER" ? position?.coords.longitude : longitude
  const mapLatitude = position && follow === "USER" ? position?.coords.latitude : latitude

  return (
    <>
    <Map
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_API}
      longitude={mapLongitude}
      latitude={mapLatitude}
      zoom={zoom}
      style={{ maxWidth: '100%', height: '100vh', cursor: 'crosshair!important' }}
      onMove={e => setViewState(e.viewState)}
      onClick={handleClick}
      mapStyle='mapbox://styles/innovatar/ckg6zpegq44ym19pen438iclf'
    >
      {/* { !triggerGeo ? <MapClickHint longitude={longitude} latitude={latitude} /> : null } */}
      <Me setFollow={setFollow}/>
      <Cursor edit={modal?.placeForm === 'edit'}/>
      { modal?.placeForm ? null : <MapPlaces/> }
      { children }
    </Map>
    </>
  )
}
