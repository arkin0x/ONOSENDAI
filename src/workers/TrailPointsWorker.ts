import { cyberspaceCoordinateFromHexString, extractCyberspaceActionState, CyberspaceAction } from '../libraries/Cyberspace'

type WorkerMessage = {
  actions: CyberspaceAction[]
  pubkey: string
  userCurrentSectorId: string
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { actions, pubkey, userCurrentSectorId } = event.data
  const coord = cyberspaceCoordinateFromHexString(pubkey)
  const spawnPosition = coord.local.vector.toVector3()

  const trailPoints = actions.map((action: CyberspaceAction) => {
    const { localCoordinate, sector } = extractCyberspaceActionState(action)
    const sectorId = sector.id
    const sectorPosition = localCoordinate.vector
    if (sectorId !== userCurrentSectorId) {
      return null
    }
    const newVec = sectorPosition.toVector3().sub(spawnPosition)
    return [newVec.x, newVec.y, newVec.z]
  }).filter(Boolean)

  self.postMessage(trailPoints)
}

export {} // This is needed to make TypeScript treat this as a module