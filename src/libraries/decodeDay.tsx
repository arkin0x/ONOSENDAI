// Parse hours string and return true if open now
export function isOpenNow(hoursString: string | undefined) {

  if (!hoursString) return false

  // Split into day groups
  const regex = /(?<=[0-9]);?:?\s*(?=[a-zA-Z])/
  const dayGroups = hoursString.split(regex)
  // Get current day/time
  const now = new Date()
  const day = now.getDay()
  const time = now.getHours() + now.getMinutes()/60

  // Loop through groups
  for (const group of dayGroups) {

    // Split days and hours
    const [days, hours] = group.split(' ')
    const [startDay, endDay] = days.split('-')

    // Get open/close times 
    const [open, close] = hours.split('-')
    const openTime = parseTime(open)
    const closeTime = parseTime(close)

    // Check if current day/time is within range
    if (isDayInSeries(startDay, endDay, day) && 
        time >= openTime && time < closeTime) {
      return true
    }

  }

  return false

}

// Helper function to get day name
// function getDayName(dayNumber) {
//   const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
//   return days[dayNumber]
// }

// Find if day is in series
function isDayInSeries(start: string, end: string, day: number) {
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const startIndex = days.indexOf(start)
  const endIndex = days.indexOf(end)
  const dayIndex = day // days.indexOf(day)
  if (startIndex < endIndex) {
    return dayIndex >= startIndex && dayIndex <= endIndex
  } else {
    return dayIndex >= startIndex || dayIndex <= endIndex
  }
}

function parseTime(timeStr: string) {
  const [hours, minutes] = timeStr.split(':')
  return parseInt(hours) + parseInt(minutes) / 60
}
