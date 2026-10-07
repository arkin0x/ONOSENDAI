import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChat } from '../useChat'
import { linkChatAndPad, usePad } from '../usePad'

// The chat dock and the touch controls, where the open dock runs through the
// controls' column (a phone) and where it does not (a desktop).
describe('the chat and the controls take turns', () => {
  let overlap = true
  let unlink: () => void = () => {}

  beforeEach(() => {
    overlap = true
    useChat.setState({ open: false, unread: 0 })
    usePad.setState({ open: true })
    unlink = linkChatAndPad(() => overlap)
  })
  afterEach(() => unlink())

  it('opening the chat puts the controls away', () => {
    useChat.getState().setOpen(true)
    expect(usePad.getState().open).toBe(false)
  })

  it('folding the chat brings the controls back when they were out', () => {
    useChat.getState().setOpen(true)
    expect(usePad.getState().open).toBe(false)
    useChat.getState().setOpen(false)
    expect(usePad.getState().open).toBe(true)
  })

  it('folding the chat leaves the controls away when they were already away', () => {
    usePad.getState().setOpen(false)
    useChat.getState().setOpen(true)
    useChat.getState().setOpen(false)
    expect(usePad.getState().open).toBe(false)
    // and the next time they are out, the chat still puts them away
    usePad.getState().setOpen(true)
    useChat.getState().setOpen(true)
    expect(usePad.getState().open).toBe(false)
  })

  it('a chat that unfolds on its own (a line arrived) is the same as opening it', () => {
    useChat.setState({ open: true })
    expect(usePad.getState().open).toBe(false)
    useChat.setState({ open: false })
    expect(usePad.getState().open).toBe(true)
  })

  it('bringing the controls back while the chat is open folds the chat', () => {
    useChat.getState().setOpen(true)
    usePad.getState().setOpen(true)
    expect(useChat.getState().open).toBe(false)
    expect(usePad.getState().open).toBe(true)
  })

  it('a scene tap that brings the controls back is the same as the CONTROLS chip', () => {
    useChat.getState().setOpen(true)
    usePad.getState().toggle()
    expect(useChat.getState().open).toBe(false)
    expect(usePad.getState().open).toBe(true)
  })

  it('the controls owe nothing to a chat that was folded by bringing them back', () => {
    useChat.getState().setOpen(true)
    usePad.getState().setOpen(true)
    usePad.getState().setOpen(false)
    useChat.getState().setOpen(true)
    useChat.getState().setOpen(false)
    expect(usePad.getState().open).toBe(false)
  })

  it('where the two do not overlap, neither touches the other', () => {
    overlap = false
    useChat.getState().setOpen(true)
    expect(usePad.getState().open).toBe(true)
    usePad.getState().setOpen(false)
    usePad.getState().setOpen(true)
    expect(useChat.getState().open).toBe(true)
    useChat.getState().setOpen(false)
    expect(usePad.getState().open).toBe(true)
  })

  it('unlinking stops it', () => {
    unlink()
    useChat.getState().setOpen(true)
    expect(usePad.getState().open).toBe(true)
  })
})
