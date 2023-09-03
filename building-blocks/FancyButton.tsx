import '../scss/FancyButton.scss'

type FancyButtonProps = {
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}

export const FancyButton: React.FC<FancyButtonProps> = ({children, size = 'sm', onClick}: FancyButtonProps) => {
  const classes = `fancybutton ${size}`
  return (
    <button className={classes} onClick={onClick}>
      {children}
    </button>
  )
}