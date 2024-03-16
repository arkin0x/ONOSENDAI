import { useActionChain } from "../hooks/cyberspace/useActionChain"

type AvatarProps = {
  pubkey: string
}

export const Avatar = ({pubkey}: AvatarProps) => {

  useActionChain(pubkey)

  // 8. return a visible avatar for threejs
  return null
}

