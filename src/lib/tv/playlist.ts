/**
 * playlist.ts: the music Cyberspace TV plays, as links to where each track
 * is hosted (arkinox, 2026-10-18: "I think we should probably stream the
 * music from wherever its hosted, so the playlist is links. a broken link =
 * just skip the track").
 *
 * Only tracks arkinox has approved for TV go here; the music is royalty free
 * and he has permission to use it. A track needs nothing but its link: its
 * name, its artist and its art are read from the file's own tags (lib/tv/id3),
 * and its art falls back to the picture of the same name beside it. Give a
 * `title`, `artist` or `art` only to correct what the file says.
 */

export interface Track {
  url: string
  title?: string
  artist?: string
  art?: string
}

export const PLAYLIST: Track[] = [
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/inflating-saturn/1-commersens-temperatur.mp3' },
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/inflating-saturn/2-saturn-day.mp3' },
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/Acid%20Alert%20EP/1_Sethy%20Bowoy-Acid%20Alert.mp3' },
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/Acid%20Alert%20EP/2_Sethy%20Bowoy-Acid%20Bench.mp3' },
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/Acid%20Alert%20EP/3_Sethy%20Bowoy-Acid%20Ocean.mp3' },
  // Its tag says only "Chasing Devils"; its file has the whole name.
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/Acid%20Alert%20EP/4_Sethy%20Bowoy-Chasing%20Devils%20Out%20Of%20Space.mp3', title: 'Chasing Devils Out Of Space' },
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/acid-in-my-lounge/1-acid-in-my-lounge.mp3' },
  { url: 'https://media.basspistol.com/panix/andra-stuk/1-distanser.mp3' },
  { url: 'https://media.basspistol.com/panix/andra-stuk/2-brustabletter.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/1-hot-ears.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/2-bonjour-tristesse.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/4-jappjapp.mp3' },
]
