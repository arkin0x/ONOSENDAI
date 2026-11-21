/**
 * BrandMarks.tsx: the X and nostr marks beside arkinox's two profile links in
 * the Official panel (arkinox, 2026-11-21: "lets add my X profile to the
 * onosendai menu official links, as well as my nostr profile under that. put
 * an appropriate icon for each").
 *
 * Lucide has no brand marks, so these two are drawn here, inline, with no
 * package or CDN behind them: the X logo (the path Simple Icons publishes,
 * CC0) and the nostr ostrich in its one-color form (the silhouette Amethyst
 * ships, MIT). Both fill with currentColor, so they take the link's accent
 * and its hover color like the text beside them, and they are sized to that
 * text. Each carries its own label for a screen reader.
 */

interface MarkProps {
  /** Width and height in px, beside 12px type: X at 11 and the ostrich at 13 read the same size. */
  size?: number
  className?: string
}

/** The X logo. */
export function XMark({ size = 11, className = 'brand-mark' }: MarkProps): JSX.Element {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="X logo">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  )
}

/** The nostr ostrich, one color. */
export function NostrMark({ size = 13, className = 'brand-mark' }: MarkProps): JSX.Element {
  return (
    <svg className={className} width={size} height={size} viewBox="-3 -4 260 260" fill="currentColor" role="img" aria-label="nostr logo">
      <path d="m59.66 98.55c-3.01-.99-5.63-2.7-8.79-3.2-9.73-1.54-20.02 2.62-26.78 9.6-3.49 3.6-6.18 8.38-7.72 13.14-.44 1.34-1.37 4.3.12 5.34 2.36 1.66 8.25-3.37 11.43-2.9-1.5 3.39-3.1 7.47-2.91 11.23.11 2.14 1.37 4.43 3.88 3.6 4.42-1.45 6.14-7.23 11.23-8-.81 2.49-4.21 10.82-.82 12.63 2.25 1.21 6.27-2.47 8.15-3.46 5.72-3.04 13.49-5.56 20.02-5.72 4.77-.12 9.39 4.77 13.67 6.6 9.01 3.86 18.45 5.87 27.84 8.51-5.55 8.16-12.99 15.02-21 20.76-3.1 2.22-6.98 2.75-9.66 5.66-3.02 3.27-3.08 8.02-5.48 11.67-7.68 11.7-15.82 23.58-24.37 34.67-4.33 5.61-12.75 3.9-16.65 10.26-2.62 4.27-.25 6.05 3.9 4.88-2.74 4.93-6.41 10.19-6.22 16.12.05 1.59.54 5.76 2.78 5.76 2.16 0 4.64-7.04 5.85-8.69 3.14-4.28 7.23-7.63 10.55-11.72 3.06-3.77 5.29-8.25 8.11-12.21 8.29-11.64 16.55-24.86 26.63-35.03 2.39-2.41 6.01-2.9 8.36-5.53 1.99-2.22 2.18-5.46 4.16-7.57 2.81-2.99 6.83-5.28 10.11-7.73 7.55-5.67 14.83-11.35 24.42-13-1.82 3.4-3.65 6.66-5.08 10.26-2.06 5.19-6.03 18.04 4.1 17.53 3.79-.19 6.35-3.14 9.77-4.32 8.99-3.1 18.22-5.86 27.35-8.53 3.83-1.12 8.14-3.34 12.21-3.16 5.05.21 2.04 7.86 6.84 9.15 2.99.81 2.12-4.52 2.44-6.27h.98c1.8 3.46 5.28 6.67 8.79 8.38 1.13.55 3.41 1.46 4.36.11 1.26-1.79-1.49-5.13-2.41-6.54-3.31-5.09-6.93-14.4-13.19-16.29-5.58-1.68-12.34 1.2-17.58 2.94-10.98 3.64-22.08 7.26-33.21 10.42 3.01-6.43 7.23-8.02 12.1-12.47 1.7-1.55 2.3-4.4 4.54-5.31 3.95-1.59 10.79-.53 15.09-.83 7.66-.53 15.2-2.6 21.98-6.2 8.97-4.77 13.78-12.66 15-22.57.42-3.42-1.09-8.67.7-11.69 2.71-4.57 11.3-7.6 15.55-10.83 9.87-7.51 17.98-19.99 18.54-32.66.47-10.68-3.26-19.68-11.23-26.86-4.15-3.74-13.69-8.05-14.51-14.16-.47-3.48 3.19-4.01 5.74-4.74 6.57-1.89 13.62.29 20.02-1.61v-.98l-6.84-2.93 6.84-.49V12.6C234.77 10.28 229.42 9.6 224.72 7.46 216.79 3.86 206.4-5.6 200.73 7.23c-8.51 19.28 8.55 30.24 20.55 41.59 6.76 6.4 8.07 17.66 2.56 25.31-6.54 9.09-14.68 6.86-24.03 6.88-2.63 0-5.21 1.65-7.81 1.22-3.83-.64-7.49-3.97-10.74-5.92-5.16-3.09-10.68-5.64-16.6-6.84-15.82-3.18-32.07-.63-46.88 5.37-9.53 3.86-18.32 9.35-27.84 13.23-7.3 2.98-15.15 3.64-22.95 3.64-2.1 0-7.82-.99-9.26.85-1.39 1.78.99 4.57 1.94 5.99z" />
    </svg>
  )
}
