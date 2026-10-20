/**
 * A picture or a name opens the person's whole profile (arkinox,
 * 2026-10-20), and your own profile's editor opens in its place.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileBadge, ProfileTap } from '../ProfileBadge'
import { useProfileView } from '../../store/useProfileView'

const PK = 'a'.repeat(64)

afterEach(() => { useProfileView.setState({ pubkey: null, editing: false }) })

describe('ProfileTap and a tappable badge', () => {
  it('is a button, so a tap on the picture or the name can open the profile', () => {
    expect(renderToStaticMarkup(<ProfileTap pubkey={PK}><span>name</span></ProfileTap>)).toMatch(/^<button type="button" class="profile-tap /)
    expect(renderToStaticMarkup(<ProfileBadge pubkey={PK} tappable />)).toMatch(/^<button type="button" class="profile-tap badge /)
  })

  it('a badge that is not tappable stays a plain span', () => {
    expect(renderToStaticMarkup(<ProfileBadge pubkey={PK} />)).toMatch(/^<span class="badge /)
  })
})

describe('useProfileView', () => {
  it('opens and closes a profile', () => {
    useProfileView.getState().open(PK)
    expect(useProfileView.getState().pubkey).toBe(PK)
    useProfileView.getState().close()
    expect(useProfileView.getState().pubkey).toBeNull()
  })

  it('EDIT PROFILE puts your editor in place of the view, and closing it closes only the editor', () => {
    useProfileView.getState().open(PK)
    useProfileView.getState().edit()
    expect(useProfileView.getState()).toMatchObject({ pubkey: null, editing: true })
    useProfileView.getState().stopEditing()
    expect(useProfileView.getState().editing).toBe(false)
  })
})
