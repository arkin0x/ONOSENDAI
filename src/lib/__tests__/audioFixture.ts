/**
 * audioFixture.ts: a test tone, made here, so no recording is ever a fixture.
 * A mono 16-bit PCM WAV of a sine at `hz` for `seconds`, at 8 kHz.
 */
export function toneWav(seconds = 0.25, hz = 440, rate = 8000): Uint8Array {
  const samples = Math.round(seconds * rate)
  const data = samples * 2
  const out = new Uint8Array(44 + data)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) }
  ascii(0, 'RIFF'); v.setUint32(4, 36 + data, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ascii(36, 'data'); v.setUint32(40, data, true)
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.3 * 32767), true)
  return out
}
