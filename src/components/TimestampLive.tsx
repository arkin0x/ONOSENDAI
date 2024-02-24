import { useState, useEffect } from 'react'

export const TimestampLive = ({start}) => {
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

  const now = Math.floor(timestamp/1000)

  const elapsed = now - start

  return (
    <>
      <div className="heavy">elapsed: {elapsed}s / {(elapsed / 60).toFixed(0)}m</div>
      <div className="light">now: {now}</div>
    </>
  )
}