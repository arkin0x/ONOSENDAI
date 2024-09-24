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

  const points: number[] = []

  actions.forEach((action: CyberspaceAction) => {
    const { localCoordinate, sector } = extractCyberspaceActionState(action)
    const sectorId = sector.id
    const sectorPosition = localCoordinate.vector
    if (sectorId === userCurrentSectorId) {
      const newVec = sectorPosition.toVector3().sub(spawnPosition)
      points.push(newVec.x, newVec.y, newVec.z)
    }
  })

  self.postMessage({ type: 'points', data: points })
  self.postMessage({ type: 'calculationComplete' })
}

export {} // This is needed to make TypeScript treat this as a module