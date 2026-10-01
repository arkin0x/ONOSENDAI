/**
 * Switch.tsx: an on/off switch, built the way shadcn/ui builds its Switch, on
 * the Radix Switch primitive, and styled in ONOSENDAI's own CSS (`.ui-switch`)
 * because this client has no Tailwind (arkinox, 2026-10-01).
 *
 * Radix supplies what a hand-built toggle usually gets wrong: it is a real
 * button with role="switch" and aria-checked, Space and Enter flip it, it
 * takes focus in tab order, and a <label htmlFor> pointing at its id flips it
 * too. Pair it with Field below for the label and an explanation.
 */

import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>): JSX.Element {
  return (
    <SwitchPrimitive.Root className={`ui-switch${className ? ` ${className}` : ''}`} {...props}>
      <SwitchPrimitive.Thumb className="ui-switch__thumb" />
    </SwitchPrimitive.Root>
  )
}

/**
 * A control with its label and a line saying what it does, the whole row
 * clickable through the label. `id` ties the label to the control.
 */
export function Field({ id, label, hint, children }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="ui-field">
      {children}
      <label className="ui-field__text" htmlFor={id}>
        <span className="ui-field__label">{label}</span>
        {hint && <span className="ui-field__hint">{hint}</span>}
      </label>
    </div>
  )
}
