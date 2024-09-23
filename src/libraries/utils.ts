
// pick a random value from an iterable
export function pickRandom<T>(iterable: Iterable<T>): T {
  const array = Array.from(iterable)
  const index = Math.floor(Math.random() * array.length)
  return array[index]
}

// Example usage:
// const result = convertSeconds(987654)
// console.log(result); // { days: 11, hours: 10, minutes: 44, seconds: 14 }
export function convertSeconds(totalSeconds: number) {
  const days = Math.floor(totalSeconds / (24 * 3600));
  totalSeconds %= 24 * 3600;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    days: days,
    hours: hours.toString().padStart(2, '0'),
    minutes: minutes.toString().padStart(2, '0'),
    seconds: seconds.toString().padStart(2, '0')
  };
}