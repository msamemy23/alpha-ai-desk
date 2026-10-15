/**
 * Photos, video and voice notes kept in the private `dvi-media` storage bucket instead of inside the inspection row.
 * The rules here are shared: the upload route checks a request with them, and the editor checks a file before it tries.
 * No imports, so the browser, the server and `node --test` all run the same code.
 */

export const MEDIA_BUCKET = 'dvi-media'

export type MediaKind = 'photo' | 'video' | 'audio'

export const MEDIA_TYPES: Record<string, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'photo', ext: 'jpg' },
  'image/png': { kind: 'photo', ext: 'png' },
  'image/webp': { kind: 'photo', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/x-m4a': { kind: 'audio', ext: 'm4a' },
  'audio/webm': { kind: 'audio', ext: 'webm' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
}

/** Biggest file accepted, in bytes, by kind. A phone video of 20 seconds at normal quality is well under this. */
export const MAX_BYTES: Record<MediaKind, number> = { photo: 3_000_000, video: 25_000_000, audio: 6_000_000 }

/** The content type without parameters: "audio/webm;codecs=opus" -> "audio/webm". */
export const baseType = (t: unknown): string => String(t || '').split(';')[0].trim().toLowerCase()

export type UploadCheck = { ok: true; kind: MediaKind; ext: string } | { ok: false; error: string }

export function checkUpload(contentType: unknown, size: unknown): UploadCheck {
  const meta = MEDIA_TYPES[baseType(contentType)]
  if (!meta) return { ok: false, error: 'That kind of file is not supported. Use a photo, a short video or a voice note.' }
  const n = Number(size)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'The file is empty.' }
  if (n > MAX_BYTES[meta.kind]) return { ok: false, error: `That ${meta.kind === 'photo' ? 'photo' : meta.kind === 'video' ? 'video' : 'voice note'} is too large (${Math.round(MAX_BYTES[meta.kind] / 1_000_000)} MB at most).` }
  return { ok: true, kind: meta.kind, ext: meta.ext }
}

/** A file name nobody could guess and nobody has to read. */
export function newMediaName(rand: () => number = Math.random): string {
  let s = ''
  while (s.length < 20) s += Math.floor(rand() * 36).toString(36)
  return s
}

/** Signed addresses last this long. A customer who opens the link later gets fresh ones. */
export const SIGNED_URL_SECONDS = 60 * 60

/** Rough size of a recording in seconds, for the label on the button. "0:07". */
export function clockText(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What a phone can record, best first. Safari writes MP4 and M4A; Chrome writes WebM (newer Chrome can also write MP4). */
export const RECORDER_TYPES: Record<'video' | 'audio', string[]> = {
  video: ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'],
}

/** The first type the browser says it can record, or '' when it will not say (the recorder then picks its own). */
export function pickRecorderType(kind: 'video' | 'audio', isSupported: (t: string) => boolean): string {
  return RECORDER_TYPES[kind].find(t => { try { return isSupported(t) } catch { return false } }) || ''
}

/** Longest clip, in seconds, so a file stays small and the customer's page loads fast. */
export const MAX_SECONDS: Record<'video' | 'audio', number> = { video: 30, audio: 60 }
