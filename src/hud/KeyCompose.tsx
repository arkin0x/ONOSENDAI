/**
 * KeyCompose.tsx: forging an item to hide (Keys and Chests B1 §3.1).
 *
 * An item is a keypair (arkinox, 2026-10-10: "keys ARE items"; a key is only
 * the role an item plays when a chest is sealed to it). The keypair is made
 * the moment the composer opens, so its public key can be read, copied and
 * sealed to before the item is hidden anywhere. The secret is never shown: it
 * goes into the bag in the item's `secret` tag at COMMIT, and a copy of the
 * item goes into your own ITEMS then, marked forged by you. PLACE ITEM hands
 * the item to the deploy (useShards `startDeployKey`), which happens in BUILD
 * mode at the build cursor like a message. An item whose deploy BUILD mode
 * had to end comes back into the composer that opens next.
 *
 * PICTURE (arkinox, 2026-10-10): one small picture the item wears as its icon
 * in ITEMS. The file is drawn onto a canvas that fits inside 32 by 32 keeping
 * its aspect (never upscaled) and exported as a PNG data URI, which rides in
 * the item's imeta tag (lib/itemPicture.ts has the fit, the tag and why only
 * a data URI). The canvas work lives here, the pure parts there.
 */

import { useEffect, useRef, useState } from 'react'
import { Explanation } from './Explanation'
import { nip19 } from 'nostr-tools'
import { forgeKey } from '../lib/chests'
import { MAX_ITEM_NAME, type KeyItem } from '../lib/hidden'
import { MAX_PICTURE_SIDE, MAX_PICTURE_URI, fitWithin, type PictureDim } from '../lib/itemPicture'
import { shortHex } from '../lib/time'
import { useBuilder } from '../store/useBuilder'
import { useShards } from '../store/useShards'

/** What the file input takes: the raster kinds every browser decodes. The result is always PNG. */
const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

/**
 * The chosen file as the picture the item will carry, or a sentence why not.
 * A GIF is drawn as its first frame. The 8,192 cap is a safety net: a busy
 * 32x32 PNG is under 4 KB, so only something odd ever hits it.
 */
async function pictureFrom(file: File): Promise<{ image: string; imageDim: PictureDim }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file could not be read as a picture.'))
      el.src = url
    })
    if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) throw new Error('That picture has no size.')
    const imageDim = fitWithin(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = imageDim.w
    canvas.height = imageDim.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot draw the picture.')
    ctx.drawImage(img, 0, 0, imageDim.w, imageDim.h)
    const image = canvas.toDataURL('image/png')
    if (image.length > MAX_PICTURE_URI) throw new Error(`That picture is ${image.length.toLocaleString('en-US')} characters as a PNG; the most an item carries is ${MAX_PICTURE_URI.toLocaleString('en-US')}.`)
    return { image, imageDim }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** `onDone` runs on CANCEL and once the item has been handed to the deploy. */
export function KeyCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // An item whose deploy ended under it comes back here, pair, name and
  // picture alike (useBuilder `itemDraft`); read in the initializer and taken
  // in an effect, as the message composer does, since React may run an
  // initializer twice.
  const [key, setKey] = useState<KeyItem>(() => {
    const draft = useBuilder.getState().itemDraft
    return draft?.type === 'key' ? draft.key : forgeKey('')
  })
  useEffect(() => { useBuilder.getState().takeItemDraft('key') }, [])
  const [copied, setCopied] = useState<string | null>(null)
  // The PICTURE control: the hidden file input, and the sentence when a file
  // was refused (the previous picture, if any, stays).
  const fileRef = useRef<HTMLInputElement>(null)
  const [pictureNote, setPictureNote] = useState<string | null>(null)
  const npub = nip19.npubEncode(key.itemPubkey)

  const copy = (what: string, text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what)
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1200)
    })
  }
  const choosePicture = (file: File | undefined): void => {
    if (!file) return
    setPictureNote(null)
    pictureFrom(file).then(
      (picture) => setKey((k) => ({ ...k, ...picture })),
      (err: unknown) => setPictureNote(err instanceof Error ? err.message : String(err)),
    )
  }
  const removePicture = (): void => {
    setPictureNote(null)
    setKey((k) => {
      const next = { ...k }
      delete next.image
      delete next.imageDim
      return next
    })
  }
  const place = (): void => {
    const name = key.name.trim()
    if (!name) return
    useShards.getState().startDeployKey({ ...key, name, about: key.about.trim() })
    onDone()
  }

  return (
    <div className="shards__compose">
      <input
        className="avatars__input"
        value={key.name}
        onChange={(e) => setKey({ ...key, name: e.target.value.slice(0, MAX_ITEM_NAME) })}
        placeholder="Name the item"
        maxLength={MAX_ITEM_NAME}
        autoFocus
        aria-label="Item name"
      />
      <input
        className="avatars__input"
        value={key.about}
        onChange={(e) => setKey({ ...key, about: e.target.value.slice(0, 280) })}
        placeholder="A sentence about it (optional)"
        aria-label="About the item"
      />
      {/* The public half, two ways: what a chest is sealed to. The secret is never shown. */}
      <div className="compose__pubkey">
        <button className="lootd__copy" title={`${npub} (click to copy)`} onClick={() => copy('npub', npub)}>{copied === 'npub' ? 'copied' : shortHex(npub, 16, 10)}</button>
        {' · '}
        <button className="lootd__copy" title={`${key.itemPubkey} (click to copy)`} onClick={() => copy('hex', key.itemPubkey)}>{copied === 'hex' ? 'copied' : shortHex(key.itemPubkey, 12, 8)}</button>
      </div>
      {/* The picture: a preview at its own size in a 32 by 32 well, then the
          buttons. The input is hidden behind PICTURE, and cleared after each
          choice so choosing the same file again fires again. */}
      <div className="compose__row">
        <input ref={fileRef} type="file" accept={PICTURE_TYPES} hidden onChange={(e) => { choosePicture(e.target.files?.[0]); e.target.value = '' }} aria-label="Picture file" />
        {key.image && key.imageDim && (
          <span className="compose__pic-box" title={`${key.imageDim.w} by ${key.imageDim.h} pixels`}>
            <img className="compose__pic-preview" src={key.image} width={key.imageDim.w} height={key.imageDim.h} alt="" />
          </span>
        )}
        <button className="chest__act" onClick={() => fileRef.current?.click()} title={`A picture for the item, fitted into ${MAX_PICTURE_SIDE} by ${MAX_PICTURE_SIDE} pixels; it is the item's icon in ITEMS`}>{key.image ? 'CHANGE PICTURE' : 'PICTURE'}</button>
        {key.image && <button className="chest__act" onClick={removePicture} title="Forge the item without a picture">REMOVE</button>}
      </div>
      {pictureNote && <span className="shards__compose-note shards__compose-note--warn" role="status">{pictureNote}</span>}
      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!key.name.trim()} onClick={place} title="Aim it at the build cursor; the item goes into your ITEMS when it is hidden">PLACE ITEM ▸</button>
      </div>
      <Explanation>
        An item is a keypair hidden in a bag: whoever reads it holds it, and it lands in their ITEMS. Seal a chest to it and only a holder can open that chest. A mini quest is four steps: forge an item, hide it somewhere, seal a chest to it with a prize inside, and hide the chest somewhere else.
      </Explanation>
    </div>
  )
}
