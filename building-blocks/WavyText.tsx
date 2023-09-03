import '../scss/WavyText.scss'

export const WavyText = ({ text }: { text: string }) => {
  const chars = text.split('')
  const markup = chars.map((x, i) => {
    return (
      <span key={i} className={`wave-${i % 30}`}>
        {x}
      </span>
    )
  })

  return <span className='wavy-text'>{markup}</span>
}
