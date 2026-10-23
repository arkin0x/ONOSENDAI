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
  { url: 'https://media.basspistol.com/sethybowoy.basspistol.com/acid-in-my-lounge/1-acid-in-my-lounge.mp3' },
  { url: 'https://media.basspistol.com/panix/andra-stuk/1-distanser.mp3' },
  { url: 'https://media.basspistol.com/panix/andra-stuk/2-brustabletter.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/1-hot-ears.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/2-bonjour-tristesse.mp3' },
  { url: 'https://media.basspistol.com/panix/autumn-leaves/4-jappjapp.mp3' },
  { url: 'https://media.basspistol.com/panix/2012-grab-bag/1-lauantai.mp3' },
  { url: 'https://media.basspistol.com/panix/2012-grab-bag/11-verbophobia.mp3' },
  { url: 'https://media.basspistol.com/panix/2012-grab-bag/3-mandaak.mp3' },
  { url: 'https://media.basspistol.com/panix/2012-grab-bag/9-skithink.mp3' },
  { url: 'https://media.basspistol.com/panix/bamegoy/1-nebelwerfer.mp3' },
  { url: 'https://media.basspistol.com/panix/br-tbients/1-br-tbient.mp3' },
  { url: 'https://media.basspistol.com/panix/br-tbients/2-br-tbient-too.mp3' },
  { url: 'https://media.basspistol.com/panix/br-tbients/3-broet-igen.mp3' },
  { url: 'https://media.basspistol.com/die_nmi_/total_disko_destruction/2026-Total%20Club%20Destruction-01%20Goin%27%20Offline.mp3' },
  { url: 'https://media.basspistol.com/die_nmi_/total_disko_destruction/2026-Total%20Club%20Destruction-03%20Da%20Mighty%20Roland%20Kaiser.mp3' },
  { url: 'https://media.basspistol.com/die_nmi_/total_disko_destruction/2026-Total%20Club%20Destruction-05%20Andy%20Borg%20Collective.mp3' },
  { url: 'https://media.basspistol.com/die_nmi_/total_disko_destruction/2026-Total%20Club%20Destruction-14%20Sour%20Sgreen%20Lickarr.mp3' },
  { url: 'https://media.basspistol.com/setto.basspistol.com/darkweb/3-swipe-instrumental-.mp3' },
  { url: 'https://media.basspistol.com/setto.basspistol.com/darkweb/4-darkweb-instrumental-.mp3' },
  { url: 'https://media.basspistol.com/setto.basspistol.com/little-bug-ep/1-ding-ding-world.mp3' },
  { url: 'https://media.basspistol.com/setto.basspistol.com/little-bug-ep/2-little-bug.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/dust-and-soda/1-the-all-new-american-holocaust.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/dust-and-soda/2-microchip-babies.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/dust-and-soda/3-the-golden-bank.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/dust-and-soda/4-chemtrail-zombie.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/dust-and-soda/5-planned-obsolescence.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/headcleaner/1-radius.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/headcleaner/2-headcleaner.mp3' },
  { url: 'https://media.basspistol.com/basspistol.com/kick-n-base-made-in-barcelona/1-larry.mp3' },
]
