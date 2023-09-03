import { useNavigate } from 'react-router-dom'

export const HomeButton = () => {
  const navigate = useNavigate()
  const goHome = () => {
    navigate('/')
  }
  return (
    <button onClick={goHome}>Home</button>
  )
}