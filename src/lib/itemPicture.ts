/**
 * itemPicture.ts: the picture an item wears, carried as an imeta tag (NIP-92).
 *
 * An item (a kind 3340 keypair item, lib/hidden.ts) may carry one small
 * picture, shown as its icon in ITEMS and wherever it is listed (arkinox,
 * 2026-10-10: "limit to 32x32px maximum and store them as data URI base64 in
 * the imeta NIP-92 tag. Display the image itself for the item icon in the
 * ITEMS panel"). NIP-92's `imeta` is one variadic tag of "key value" strings
 * that MUST carry a `url` entry and at least one more field; the url here is
 * a data URI, never an address:
 *
 *   ["imeta", "url data:image/png;base64,....", "m image/png", "dim 32x32"]
 *
 * NIP-92 also asks that the url appear in the content of a kind 1 note. This
 * is kind 3340, whose content is the hider's sentence about the item, and the
 * tag alone is the rule here.
 *
 * Only a data URI is accepted, writing or reading. An http(s) picture would
 * make every reader's client fetch the hider's server the moment the item is
 * listed, telling the hider the reader's address and when they read the item;
 * a data URI fetches nothing. The caps keep an item small: 32 pixels a side,
 * and 8,192 characters for the whole URI (a busy 32x32 PNG is under 4 KB, so
 * the cap is a safety net, not a budget). A reader that finds anything else
 * in the tag ignores the tag and reads the item as one without a picture.
 *
 * Pure: the canvas work that makes the PNG stays in the composer (KeyCompose).
 */

/** The longest side a picture may have, in pixels. */
export const MAX_PICTURE_SIDE = 32
/** The longest data URI a picture may be, in characters. */
export const MAX_PICTURE_URI = 8_192

/** A picture's width and height, in pixels. */
export interface PictureDim { w: number; h: number }

/** What an imeta tag says about a picture this client accepts: the data URI and its size. */
export interface ItemPicture { image: string; dim: PictureDim }

/**
 * A raster picture as a base64 data URI, and nothing else: PNG, JPEG, GIF or
 * WebP. An SVG is a document, not a picture, and no scheme but `data:` ever
 * reaches an <img> from here (see the header). The body is checked as base64
 * so nothing but the alphabet of one can ride in a src attribute.
 */
const PICTURE_URI = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** Whether `s` is a picture this client will write into a tag or show from one. */
export function isPictureUri(s: string): boolean {
  return s.length <= MAX_PICTURE_URI && PICTURE_URI.test(s)
}

/** Whether a size is one a picture may have: whole pixels, 1 to 32 a side. */
export function fitsDim(dim: PictureDim): boolean {
  return Number.isInteger(dim.w) && Number.isInteger(dim.h) && dim.w >= 1 && dim.h >= 1 && dim.w <= MAX_PICTURE_SIDE && dim.h <= MAX_PICTURE_SIDE
}

/**
 * The size a picture of `w` by `h` is drawn at to fit inside `max` by `max`,
 * keeping its aspect: a picture already inside is kept at its size, never
 * upscaled, and a larger one is scaled down until its longer side is `max`.
 * Never below one pixel a side. A size with no area fits as one pixel.
 */
export function fitWithin(w: number, h: number, max = MAX_PICTURE_SIDE): PictureDim {
  if (!(w > 0) || !(h > 0)) return { w: 1, h: 1 }
  if (w <= max && h <= max) return { w: Math.round(w), h: Math.round(h) }
  const scale = max / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/**
 * The fields of an imeta tag, by key: each entry after the tag's name is
 * "key value", split at the first space. The first entry of a key wins; an
 * entry with no space, or with nothing after it, says nothing.
 */
export function imetaFields(tag: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of tag.slice(1)) {
    const i = entry.indexOf(' ')
    if (i <= 0 || i === entry.length - 1) continue
    const key = entry.slice(0, i)
    if (!(key in out)) out[key] = entry.slice(i + 1)
  }
  return out
}

/** A `dim` field as a size, or null when it is not `WxH` in whole pixels. */
export function parseDim(s: string | undefined): PictureDim | null {
  const m = s === undefined ? null : /^([1-9]\d{0,4})x([1-9]\d{0,4})$/.exec(s)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

/**
 * The imeta tag that carries a picture, or null when the picture is not one
 * this client would accept back (so a corrupt draft never writes a tag no
 * reader honors). The mime is the data URI's own.
 */
export function imetaTag(image: string, dim: PictureDim): string[] | null {
  if (!isPictureUri(image) || !fitsDim(dim)) return null
  const mime = image.slice('data:'.length, image.indexOf(';'))
  return ['imeta', `url ${image}`, `m ${mime}`, `dim ${dim.w}x${dim.h}`]
}

/**
 * The picture an item's tags carry, or null: the first imeta tag whose url is
 * a picture data URI (isPictureUri, which caps its length) and whose dim is
 * at most 32 by 32. Any other imeta tag, an http(s) url among them, is passed
 * over, and the item reads fine without a picture. A tag that is not an array
 * of strings is passed over the same way, as hidden.ts does with every tag.
 */
export function pictureOf(tags: readonly unknown[]): ItemPicture | null {
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'imeta' || !tag.every((v) => typeof v === 'string')) continue
    const fields = imetaFields(tag as string[])
    const image = fields.url
    const dim = parseDim(fields.dim)
    if (image === undefined || !isPictureUri(image) || !dim || !fitsDim(dim)) continue
    return { image, dim }
  }
  return null
}
