import { adjustLabor } from "./WorkerManager"

export type HashpowerAllocationTarget = 'observation' | 'movement' | 'action'

export type HashpowerAllocation = {
  [key in HashpowerAllocationTarget]: number
}

const hashpowerAllocation: HashpowerAllocation = {
  'observation': 4,
  'movement': 5,
  'action': 1,
}

export const updateHashpowerAllocation = (newAllocation?: HashpowerAllocation) => {

  // call with no args to get the current allocation
  if (!newAllocation) {
    adjustLabor(hashpowerAllocation)
    return hashpowerAllocation
  }

  // ensure that the new allocation is valid
  // test that the correct keys are being used
  const validKeys = ['observation', 'movement', 'action']
  const newAllocationKeys = Object.keys(newAllocation)
  const keysAreValid = newAllocationKeys.every((key) => validKeys.includes(key))
  // test that every value is a number
  const valuesAreValid = Object.values(newAllocation).every((value) => typeof value === 'number' && isNaN(value) === false)
  if (!keysAreValid || !valuesAreValid) {
    console.warn('Invalid hashpower allocation key received.')
    return hashpowerAllocation // just return the previous allocation
  }

  // validate that the sum of the new allocation is 10
  const sum = Object.values(newAllocation).reduce((a, b) => a + b, 0)
  if (sum !== 10) {
    console.warn('Invalid hashpower allocation sum received.')
    return hashpowerAllocation // just return the previous allocation
  }

  // copy new values into hashpowerAllocation
  Object.keys(newAllocation).forEach((key) => {
    const target = key as HashpowerAllocationTarget
    hashpowerAllocation[target] = newAllocation[target] as number
  })

  // update thermodynamic posture
  adjustLabor(hashpowerAllocation)

  return hashpowerAllocation
}
