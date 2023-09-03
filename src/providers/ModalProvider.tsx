import { useState, createContext } from 'react'
import { ModalContextType, defaultModalContext } from '../types/ModalType'

type ModalProviderProps = {
  children: React.ReactNode;
}

export const ModalContext = createContext<ModalContextType>(defaultModalContext)

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
  const [placeForm, setPlaceForm] = useState<boolean|'edit'>(false)

  const context: ModalContextType = {
    modal: {
      placeForm,
      setPlaceForm,
    }
  }
  return (
    <ModalContext.Provider value={context}>
      {children}
    </ModalContext.Provider>
  )
}
