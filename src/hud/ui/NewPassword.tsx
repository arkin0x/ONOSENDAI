/**
 * NewPassword.tsx - the two fields a new password is typed into
 * (lib/keyAtRest.ts), with its strength or what is wrong with it on one line
 * of fixed height, so nothing below it moves as it changes. LoginModal uses
 * it for a pasted nsec; KeyLockGate for a key saved plain before keys were
 * encrypted.
 */

import { STRENGTH_LABEL, explainPassword, passwordProblem, passwordStrength } from '../../lib/keyAtRest'

/** Two fields for a new password, and one line saying how good it is or what is wrong. */
export function NewPassword({ password, again, onPassword, onAgain, autoFocus = false }: {
  password: string
  again: string
  onPassword: (value: string) => void
  onAgain: (value: string) => void
  autoFocus?: boolean
}): JSX.Element {
  const level = passwordStrength(password)
  const problem = passwordProblem(password, again)
  // A mismatch is only news once the second field has something in it.
  const hint = problem === 'too-short' || !password
    ? explainPassword('too-short')
    : problem === 'mismatch' && again
      ? explainPassword('mismatch')
      : STRENGTH_LABEL[level]
  const tone = problem === 'mismatch' && again ? 'bad' : level === 0 ? 'dim' : `l${level}`
  return (
    <div className="keypw">
      <input
        className="avatars__input login__input"
        type="password"
        autoComplete="new-password"
        autoFocus={autoFocus}
        placeholder="choose a password"
        aria-label="Choose a password"
        value={password}
        onChange={(event) => onPassword(event.target.value)}
      />
      <input
        className="avatars__input login__input"
        type="password"
        autoComplete="new-password"
        placeholder="repeat password"
        aria-label="Repeat password"
        value={again}
        onChange={(event) => onAgain(event.target.value)}
      />
      <div className={`keypw__hint keypw__hint--${tone}`} aria-live="polite">
        <span className="keypw__meter" aria-hidden="true" data-level={level}><i /><i /><i /></span>
        <span>{hint}</span>
      </div>
    </div>
  )
}

/** Whether two new passwords will do: what the SAVE buttons wait on. */
export function newPasswordReady(password: string, again: string): boolean {
  return passwordProblem(password, again) === null
}
