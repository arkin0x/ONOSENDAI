/**
 * NewcomerSetting.tsx: Settings > Interface, the screen's two ways (new-user
 * feedback, 2026-11-21; newcomer/useNewcomer.ts).
 *
 * SHOW EVERYTHING is today's full HUD. NEWCOMER VIEW is plain names
 * (newcomer/names.ts) and only what the tour has reached (newcomer/reveal.ts);
 * outside a tour run, everything the tour teaches. The choice is kept for the
 * identity on screen, in IndexedDB. With none made, a newcomer sees the
 * newcomer view until the tour is finished or skipped, and everyone else
 * sees everything; the lit button always says which is on now.
 *
 * Two half-width buttons, as CREATE and ITEMS pair theirs.
 */

import { setHudChoice, useNewcomerView } from '../newcomer/useNewcomer'

export const HUD_SETTING_TITLE = 'Screen'
export const HUD_SETTING_HINT = 'Newcomer view shows only what the tour has reached, in plain words.'

export function NewcomerSetting(): JSX.Element {
  const plain = useNewcomerView()
  return (
    <div className="ui-field nc-setting" role="group" aria-labelledby="view-hud-title">
      <span className="ui-field__text">
        <span className="ui-field__label" id="view-hud-title">{HUD_SETTING_TITLE}</span>
        <span className="ui-field__hint">{HUD_SETTING_HINT}</span>
      </span>
      <div className="nc-setting__pair">
        <button className={`nc-setting__opt${plain ? '' : ' is-on'}`} aria-pressed={!plain} onClick={() => setHudChoice('everything')}>SHOW EVERYTHING</button>
        <button className={`nc-setting__opt${plain ? ' is-on' : ''}`} aria-pressed={plain} onClick={() => setHudChoice('newcomer')}>NEWCOMER VIEW</button>
      </div>
    </div>
  )
}
