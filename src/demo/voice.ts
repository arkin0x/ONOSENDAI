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

/** Voices tried in order, by name (a substring, case-insensitive). */
export const PREFERRED_VOICES = [
  'Microsoft Guy Online (Natural)',
  'Microsoft Andrew',
  'Microsoft David',
  'Google UK English Male',
  'Daniel',
  'Alex',
]

/** Words in a voice's name that suggest a male voice, for the fallback. */
const MALE_HINTS = /\b(male|man|guy|andrew|david|daniel|alex|fred|george|james|john|mark|thomas|oliver|arthur|aaron|ryan|liam|christopher|eric|roger|brian|steffan)\b/i

/** The rate and pitch that read as unhurried and a little low. */
export const VOICE_RATE = 0.92
export const VOICE_PITCH = 0.9

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang'>

/**
 * The voice to read with: the first preferred name present, else an English
 * voice whose name suggests male, else null (the browser's default).
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  for (const want of PREFERRED_VOICES) {
    const w = want.toLowerCase()
    const hit = voices.find((v) => v.name.toLowerCase().includes(w))
    if (hit) return hit
  }
  const english = voices.filter((v) => /^en\b|^en[-_]/i.test(v.lang))
  return english.find((v) => MALE_HINTS.test(v.name)) ?? null
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
