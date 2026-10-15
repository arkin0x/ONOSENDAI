/**
 * voice.ts: the tour's SPEAK, a "professorly" male English voice (arkinox,
 * 2026-10-14). Only ever started by a tap on SPEAK, and stopped whenever
 * the step changes or the tour ends. The Web Speech API: nothing leaves the
 * device.
 */

/** Whether this browser can speak; SPEAK is left out where it cannot (as AgentTalk's). */
export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/**
 * Voices tried in order, by name: a whole-word match, case-insensitive, among
 * English voices only. The Web Speech API has no gender field, so male is
 * chosen by name (arkinox, 2026-10-15: "male if possible"). What each
 * platform offers, as far as is known:
 * - Edge (Windows, macOS): the Online (Natural) voices, Guy and Andrew first.
 * - Windows, Chrome and Firefox: the installed David, Mark and George.
 * - Chrome desktop: Google UK English Male (its only male English voice).
 * - macOS and iOS (Safari and every iOS browser): Daniel, Alex, Aaron,
 *   Arthur, Fred, Gordon, Rishi, and the Siri-era Tom, Evan, Nathan, Reed.
 * - Android: Google's voices are named by code; a few codes are male
 *   (ANDROID_MALE). Chrome on Android usually names them only by language,
 *   and then the default voice reads.
 */
export const PREFERRED_VOICES = [
  'Microsoft Guy Online (Natural)',
  'Microsoft Andrew',
  'Microsoft Christopher',
  'Microsoft Davis',
  'Microsoft Ryan',
  'Microsoft Eric',
  'Microsoft Brian',
  'Microsoft Roger',
  'Microsoft Steffan',
  'Microsoft David',
  'Microsoft Mark',
  'Microsoft George',
  'Google UK English Male',
  'Daniel',
  'Alex',
  'Aaron',
  'Arthur',
  'Fred',
  'Gordon',
  'Rishi',
  'Tom',
  'Evan',
  'Nathan',
  'Reed',
]

/** Android's Google voices whose codes are male (en-US iol, iom, tpd; en-GB gbd, rjs; en-AU aub, aud). */
const ANDROID_MALE = /\ben-(us-x-(iol|iom|tpd)|gb-x-(gbd|rjs)|au-x-(aub|aud))\b/i

/** Words in a voice's name that suggest a male voice, for the fallback. */
const MALE_HINTS = /\b(male|man|guy|andrew|david|davis|daniel|alex|fred|george|james|john|mark|thomas|oliver|arthur|aaron|ryan|liam|christopher|eric|roger|brian|steffan|gordon|rishi|evan|nathan|reed)\b/i

/** The rate and pitch that read as unhurried and a little low. */
export const VOICE_RATE = 0.92
export const VOICE_PITCH = 0.9

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang'>

/** Whether a voice reads English; a voice with no language given is let through. */
function isEnglish(v: VoiceLike): boolean {
  return v.lang === '' || /^en\b|^en[-_]/i.test(v.lang)
}

/** `want` as a whole word (or words) of a voice's name. */
function nameHas(name: string, want: string): boolean {
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(name)
}

/**
 * The voice to read with: the first preferred name present, else an Android
 * voice code that is male, else an English voice whose name suggests male,
 * else null (the browser's default).
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const english = voices.filter(isEnglish)
  for (const want of PREFERRED_VOICES) {
    const hit = english.find((v) => nameHas(v.name, want))
    if (hit) return hit
  }
  return english.find((v) => ANDROID_MALE.test(v.name) || ANDROID_MALE.test((v as { voiceURI?: string }).voiceURI ?? ''))
    ?? english.find((v) => MALE_HINTS.test(v.name))
    ?? null
}

/** Voices load late in some browsers: the list is empty until `voiceschanged`. */
function voicesNow(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis
  const now = synth.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => { synth.removeEventListener('voiceschanged', done); resolve(synth.getVoices()) }
    synth.addEventListener('voiceschanged', done)
    window.setTimeout(done, 1500)
  })
}

/** Read `text` aloud; `onEnd` runs when it finishes, fails or is stopped. */
export async function speak(text: string, onEnd: () => void): Promise<void> {
  if (!canSpeak()) { onEnd(); return }
  const synth = window.speechSynthesis
  synth.cancel()
  const voices = await voicesNow()
  const u = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(voices)
  if (voice) { u.voice = voice; u.lang = voice.lang }
  u.rate = VOICE_RATE
  u.pitch = VOICE_PITCH
  u.onend = onEnd
  u.onerror = onEnd
  synth.speak(u)
}

/** Stop whatever the tour is reading. */
export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel()
}
