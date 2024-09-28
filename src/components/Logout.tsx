import { useEffect } from "react"
import useNDKStore from "../store/NDKStore"
import Loading from "./Loading"

export const Logout = () => {
  const { resetUser } = useNDKStore()

  useEffect(() => {
    resetUser()
    window.location.href='/'
  }, [resetUser])

  return <Loading/>
}