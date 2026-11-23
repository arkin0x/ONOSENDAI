/**
 * PayTerms.tsx - the one small line beside every pay button (owner,
 * 2026-11-23: "Go ahead"): payments are final, and the Terms are a tap away.
 * No checkbox and no extra tap, only the line, so paying stays one press.
 *
 * Every place that asks for sats shows it: RIDE VIA HOSAKA, the Offload
 * Estimate's PAY, the invoice itself, the compute top-up, the HOSAKA offer,
 * a HOSAKA scan and a HOSAKA hide or seal. The link is absolute, so it opens
 * the live Terms page in a new tab from anywhere the app runs.
 *
 * `scene` is for a line drawn straight over the 3D scene (the scan dock),
 * which gets white text and the dock's dark edge to stay readable on any
 * background; inside a panel or a modal it is the dim note every panel uses.
 */

/** The Terms page, live since ONOSENDAI #904. */
export const PAY_TERMS_URL = 'https://www.onosendai.tech/terms'

interface Props {
  /** Drawn over the scene rather than inside a panel. */
  scene?: boolean
  className?: string
}

export function PayTerms({ scene = false, className }: Props): JSX.Element {
  return (
    <p className={`payterms${scene ? ' payterms--scene' : ''}${className ? ` ${className}` : ''}`} data-testid="pay-terms">
      Payments are final.{' '}
      <a href={PAY_TERMS_URL} target="_blank" rel="noopener noreferrer">TERMS</a>
    </p>
  )
}
