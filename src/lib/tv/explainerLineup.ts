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
 *   title     what the tag under the live picture says, short
 *   duration  its length, seconds: the guard that ends it if it never does
 *   files     the same video, in the order to try: each a link, its type
 *             with codecs (the first this browser plays is used), and its
 *             sha256 if the link does not end in it. A second link to the
 *             same file on another server is a mirror.
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

/** Every explainer, in the order they take turns. Empty: none plays until one is added. */
export const EXPLAINERS: Explainer[] = []
