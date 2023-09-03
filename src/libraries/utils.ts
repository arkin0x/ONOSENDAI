
// pick a random value from an iterable
export function pickRandom<T>(iterable: Iterable<T>): T {
  const array = Array.from(iterable)
  const index = Math.floor(Math.random() * array.length)
  return array[index]
}