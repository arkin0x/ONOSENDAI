/**
 * useChainUi.ts - which chain-status explanations and prompts are on screen.
 *
 * Shared between the status strip under the LIVE/LOCAL switch, the chain
 * panel and the held-chain conflict prompt, which open and close each other
 * (hud/ChainStatus.tsx, hud/ChainConflict.tsx). UI only: nothing here is
 * about the chain itself, which lives in useCyberspace.
 */

import { create } from 'zustand'

interface ChainUiState {
  /** The explanation modal for the current chain status is open. */
  explaining: boolean
  /**
   * The conflict prompt was set aside with a tap outside it. The conflict
   * itself stands until it is answered: no move is taken, the strip under
   * the switch says so, and a tap there or a commit brings the prompt back.
   */
  promptAside: boolean
  /**
   * The broken-chain modal (hud/BrokenChain.tsx): `notice` says which event
   * broke the chain and why, `confirm` is the respawn's warning and its
   * confirm step; null when closed.
   */
  brokenView: 'notice' | 'confirm' | null
  /**
   * The chain explorer's body is open under the CHAIN chip. Here rather than
   * in the explorer so the Chain panel's ACTIONS tag can open and close it in
   * BUILD mode, where a step along the chain would aim the build cursor.
   */
  explorerOpen: boolean
  setExplorerOpen: (open: boolean) => void
  setExplaining: (open: boolean) => void
  setPromptAside: (aside: boolean) => void
  setBrokenView: (view: 'notice' | 'confirm' | null) => void
}

export const useChainUi = create<ChainUiState>((set) => ({
  explaining: false,
  promptAside: false,
  brokenView: null,
  explorerOpen: false,
  setExplorerOpen: (explorerOpen) => set({ explorerOpen }),
  setExplaining: (explaining) => set({ explaining }),
  setPromptAside: (promptAside) => set({ promptAside }),
  setBrokenView: (brokenView) => set({ brokenView }),
}))
