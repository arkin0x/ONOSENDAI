import { PublishedConstructType, UnpublishedConstructType } from "../types/Construct"
import { getConstructProofOfWork, hexToUint8 } from "./Hash"
import { getTag } from "./Nostr"

function summation(n: number): number {
  if (n < 2) {
    return n
  } else {
    return n + summation(n - 1)
  }
}

export function constructSizeByValidProofOfWork(pow: number): number {
  return Math.floor(Math.pow(summation(pow), pow / 32))
}

export const emptyHex256 = "0000000000000000000000000000000000000000000000000000000000000000"


export const sortUnpublishedConstructsPOW = (a: UnpublishedConstructType,b: UnpublishedConstructType) => {
  // sort by highest proof of work
  return b.workCompleted - a.workCompleted
}

export const sortPublishedConstructsPOW = (a: PublishedConstructType,b: PublishedConstructType) => {
  // determine work completed
  const aNonce = a.tags.find(getTag('nonce'))
  const aNonceValue = aNonce?.[2]
  if (!aNonceValue) return 0
  const aWork = getConstructProofOfWork(hexToUint8(a.id), hexToUint8(aNonceValue))

  const bNonce = b.tags.find(getTag('nonce'))
  const bNonceValue = bNonce?.[2]
  if (!bNonceValue) return 0
  const bWork = getConstructProofOfWork(hexToUint8(b.id), hexToUint8(bNonceValue))

  // sort by highest proof of work
  return bWork - aWork
}
