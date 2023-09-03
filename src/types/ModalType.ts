export type ModalType = {
  placeForm: boolean|'edit';
  setPlaceForm: React.Dispatch<React.SetStateAction<boolean|'edit'>>;
} | null

export type ModalContextType = {
  modal: ModalType;
}

export const defaultModalContext: ModalContextType = {
  modal: null
}