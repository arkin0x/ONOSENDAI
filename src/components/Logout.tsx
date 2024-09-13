import { useEffect } from "react"
import useNDKStore from "../store/NDKStore"
import Loading from "./Loading"

export const Logout = () => {
  const { resetUser } = useNDKStore()

  useEffect(() => {
    resetUser()
    window.location.href='/'
  }, [])

  return (
    <div id="login">
      <h1>Logging Out...</h1>
      <Loading/>
    </div>
  )
}