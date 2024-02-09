import { useState, useEffect } from 'react'

export const TimestampLive = () => {
  const [timestamp, setTimestamp] = useState(Date.now())

  useEffect(() => {
    let renderLoop: number
    const frame = () => {
      setTimestamp(Date.now())
      renderLoop = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(renderLoop)
  }, [])

  return <div className="heavy" style={{ margin: "1rem"}}>{Math.floor(timestamp/1000)}</div>
}