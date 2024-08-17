import { getSectorDecimalFromId, getSectorIdDecimalFromDecimal } from "./Cyberspace"
import { DecimalVector3 } from "./DecimalVector3"

export const MAP_SIZE = 2**30
export const MAP_SECTOR_SIZE = 1.1

export function sectorIdToMapCoord(sectorId: string): DecimalVector3 {
  const xyz = getSectorDecimalFromId(sectorId)
  const mapXYZ = xyz.multiplyScalar(MAP_SECTOR_SIZE)
  return mapXYZ
}

export function cyberspacePositionToMapCoord(position: DecimalVector3): DecimalVector3 {
  const mapXYZ = getSectorIdDecimalFromDecimal(position).multiplyScalar(MAP_SECTOR_SIZE).add(new DecimalVector3(MAP_SECTOR_SIZE/2, MAP_SECTOR_SIZE/2, MAP_SECTOR_SIZE/2))
  return mapXYZ
}