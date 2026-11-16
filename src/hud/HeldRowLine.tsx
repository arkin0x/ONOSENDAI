/**
 * HeldRowLine.tsx: the words of a row in KEY ITEMS, OTHER LOOT and the
 * FEED, beside its picture, and a value in a row's DETAILS that copies on a
 * tap. Shared, so a key item shown with a lock (KeyListingRow) is laid out
 * exactly as it is in ITEMS.
 */

import type { ReactNode } from 'react'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { CopyValue } from './ui/CopyValue'

/** A label and a shortened value in a DETAILS list; a tap copies the whole value. */
export function Copyable({ label, value, title }: { label: string; value: string; title: string }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd><CopyValue className="lootd__copy" value={value} shown={shortHex(value, 14, 8)} title={`${title}\n${value}\nTap to copy`} /></dd>
    </>
  )
}

/**
 * The words of a row in KEY ITEMS or OTHER LOOT, beside its picture (owner,
 * 2026-11-15: "Can you figure out a better layout for the other loot?"):
 * the name on one line, cut with an ellipsis; where it came from and how
 * long ago on the second, the source cut before the age is; what it is now
 * (REDEEMED, LISTED, opens 2 chests, ARCHIVED, UNSIGNED) as small chips on
 * the third. A long name never pushes anything off the row.
 */
export function HeldRowLine({ name, title, source, how, at, chips }: { name: string; title?: string; source: ReactNode; how?: string; at: number; chips?: ReactNode }): JSX.Element {
  return (
    <span className="item__line held__line">
      <span className="item__name" title={title ?? name}>{name}</span>
      <span className="item__meta held__meta">
        <span className="held__src">{source}</span>
        <span className="held__age">{'\u00a0· '}{how ? `${how} ` : ''}<span title={formatStamp(at)}>{formatAgo(at)}</span></span>
      </span>
      {chips && <span className="held__chips">{chips}</span>}
    </span>
  )
}
