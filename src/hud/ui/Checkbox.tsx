/**
 * Checkbox.tsx: a checkbox built the way shadcn/ui builds its Checkbox, on the
 * Radix Checkbox primitive, styled in ONOSENDAI's own CSS (`.ui-checkbox`)
 * rather than the browser's native box, which ignored the client's look
 * (arkinox, 2026-10-01). Radix gives it role="checkbox", aria-checked, Space
 * to toggle and a label link through htmlFor. Use it inside Field (Switch.tsx).
 */

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'

export function Checkbox({ className, ...props }: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>): JSX.Element {
  return (
    <CheckboxPrimitive.Root className={`ui-checkbox${className ? ` ${className}` : ''}`} {...props}>
      <CheckboxPrimitive.Indicator className="ui-checkbox__mark">
        <Check size={12} strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
