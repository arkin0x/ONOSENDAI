/**
 * explainerLineup.ts: the short cyberspace explainers Cyberspace TV rolls
 * between shots (arkinox, 2026-10-23: "I want to add cyberspace explainers
 * right into the lineup of cyberspace TV"). Data only: adding one is a new
 * entry here, nothing else (lib/tv/explainer has how they play).
 *
 * Each is public broadcast media, as the music is, not anything found in
 * the world, so it is hosted in the clear: on Blossom, by its hash, where
 * the file's sha256 is its name and is checked before it plays, so a
 * server can neither swap it nor break it unseen (a wrong file is skipped).
 *
 * An entry:
 *   id        stable, versioned: `<n>-<name>`, for /tv?explainer=<id>
 *   title     what its tag says, short (the site's TV shows it; the stream does not)
 *   duration  its length, seconds: the guard that ends it if it never does
 *   files     the same video, in the order to try: each a link, its type
 *             with codecs (the first this browser plays is used), and its
 *             sha256 if the link does not end in it. A file with no hash is
 *             never played. A second link to the same file on another
 *             server is a mirror (not cdn.nostrcheck.me, which serves a
 *             re-encoded file under the original hash: it would be skipped).
 *   captions  a WebVTT file's link, optional, painted on the tube
 *
 * For example:
 *   {
 *     id: '1-what-is-cyberspace',
 *     title: 'WHAT IS CYBERSPACE?',
 *     duration: 48,
 *     files: [
 *       { url: 'https://blossom.band/<sha256>.webm', type: 'video/webm; codecs="vp9, opus"' },
 *       { url: 'https://blossom.band/<sha256>.mp4', type: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"' },
 *     ],
 *     captions: 'https://blossom.band/<sha256>.vtt',
 *   },
 */

import type { Explainer } from './explainer'

/** Every explainer, in the order they take turns. */
export const EXPLAINERS: Explainer[] = [
  // arkinox's first (2026-10-23), uploaded by him to nostr.build: not
  // hash-addressed, so the hash is pinned here. Captions from his words,
  // none over his own onosendai.tech -> WORKSHOP card (33.0 to 38.2 s).
  {
    id: '1-welcome-to-cyberspace',
    title: 'Welcome to Cyberspace',
    duration: 48.566,
    files: [
      { url: 'https://v.nostr.build/7fhEpkDbBuEd3QK5JXrCG5.mp4', type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', sha256: '0d47e296ef366848ac7d14ee4ab67a318fbdd18ab63db64bb88bbfafec289eb6' },
    ],
    captions: '/explainers/welcome-to-cyberspace.vtt',
  },
]
