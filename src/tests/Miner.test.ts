import { expect, test } from "vitest"
import { incrementNonceBufferBy } from '../libraries/Miner.ts'

test('incrementNonceBufferBy should correctly increment the buffer', () => {
  // Initialize a buffer
  const buffer = new Uint8Array([48, 48, 48, 48, 48, 48, 48, 48])

  // Define the start and end indices
  const startIndex = 0
  const endIndex = buffer.length

  // Define the increment
  const increment = 1_000_000

  // Call the function
  const result = incrementNonceBufferBy(buffer, startIndex, endIndex, increment)

  console.log('check result: hex:',Array.from(result).map((byte) => (byte - 48).toString(16)), 'dec: ',result)

  // Check the result
  expect(result).toEqual(new Uint8Array([48, 48, 48, 63, 52, 50, 52, 48]))
})