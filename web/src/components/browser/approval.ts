// What an approval card says, and which files may ever be saved to a device. Pure, so it can be tested on its own.
import type { ApprovalDetails, ApprovalKind } from '../../lib/browser/actions.ts'

export interface ApprovalView {
  title: string
  /** One sentence naming exactly what will happen and where. Written by the server from the real action. */
  headline: string
  host: string
  address: string
  fields: Array<{ label: string; value: string }>
  why: string
  approve: string
  deny: string
  asker: string
  lasts: string
}

const APPROVE: Record<ApprovalKind, string> = {
  submit: 'Approve and send',
  send: 'Approve and send',
  purchase: 'Approve and continue',
  download: 'Approve and download',
  delete: 'Approve and go ahead',
  terms: 'Approve and agree',
  open_site: 'Approve and open the site',
}

export const DENY_WORDS = 'Do not do this'
export const APPROVAL_LASTS = 'This request lasts 10 minutes.'

export function approveLabel(kind: ApprovalKind): string {
  return APPROVE[kind] || 'Approve'
}

const clip = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Everything the card shows, cleaned and shortened. Nothing is added that the server did not say. */
export function viewApproval(details: ApprovalDetails, actor: 'user' | 'ai'): ApprovalView {
  const fields = (Array.isArray(details.fields) ? details.fields : []).slice(0, 12).map(f => ({ label: clip(f?.label, 80) || 'Entry', value: clip(f?.value, 200) }))
  return {
    title: clip(details.title, 80) || 'Needs your OK',
    headline: clip(details.summary, 800),
    host: clip(details.host, 253),
    address: clip(details.url, 600),
    fields,
    why: clip(details.why, 300),
    approve: approveLabel(details.kind),
    deny: DENY_WORDS,
    asker: actor === 'ai' ? 'Alpha wants to do this.' : 'You asked for this.',
    lasts: APPROVAL_LASTS,
  }
}

/* ---------- downloads: plain files only ---------- */

/** The only files Alpha ever saves to a device: PDFs, pictures and text. */
export const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
}

export const FILE_WORDS = 'Alpha only saves PDFs, pictures and text files.'

const PROGRAM = /^(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|apk|dmg|pkg|app|sh|bash|run|bin|dll|sys|lnk|reg|iso|img|appimage|deb|rpm|hta|cpl|msp|crx)$/i

export function fileExtension(name: string): string {
  const base = String(name || '').split(/[/\\]/).pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}

/** The last piece of an address as a file name. */
export function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    return decodeURIComponent(last).slice(0, 120)
  } catch {
    return ''
  }
}

export interface DownloadVerdict { allowed: boolean; reason: string; name: string; ext: string }

/**
 * Before the person is even asked: can this address be saved at all? An address that names a program, an archive or a
 * document of another kind is not offered. An address with no file ending is allowed here and checked once it arrives.
 */
export function downloadVerdict(url: string): DownloadVerdict {
  const name = fileNameFromUrl(url)
  const ext = fileExtension(name)
  if (!ext) return { allowed: true, reason: '', name: name || 'file', ext: '' }
  if (FILE_TYPES[ext]) return { allowed: true, reason: '', name, ext }
  if (PROGRAM.test(ext)) return { allowed: false, reason: 'That file is a program or script. Alpha does not download those.', name, ext }
  return { allowed: false, reason: `${FILE_WORDS} This one ends in .${ext}.`, name, ext }
}

export type SniffedKind = 'pdf' | 'png' | 'jpg' | 'gif' | 'webp' | 'text'

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false
  return true
}

/** What the first bytes of a file say it is. Anything not on the short list is null. */
export function sniffFile(bytes: Uint8Array): SniffedKind | null {
  if (!bytes || bytes.length < 4) return null
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif' // GIF8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp' // RIFF....WEBP
  return looksLikeText(bytes) ? 'text' : null
}

function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  let odd = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) odd++
  }
  if (odd / n > 0.02) return false
  let head = ''
  try { head = new TextDecoder('utf-8').decode(bytes.slice(0, Math.min(bytes.length, 1024))).replace(/^﻿/, '').trimStart().toLowerCase() } catch { return false }
  // A web page or a picture made of code is not a plain text file.
  if (head.startsWith('<') && /<(html|svg|script|iframe|!doctype)/.test(head)) return false
  return true
}

const KIND_EXT: Record<SniffedKind, string[]> = {
  pdf: ['pdf'], png: ['png'], jpg: ['jpg', 'jpeg'], gif: ['gif'], webp: ['webp'], text: ['txt', 'csv'],
}

/** A name that cannot climb out of a folder, hide a program or carry odd characters. */
export function cleanSaveName(raw: string): string {
  const base = String(raw || 'file').split(/[/\\]/).pop() || 'file'
  return base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 120) || 'file'
}

export type SaveVerdict = { ok: true; name: string; mime: string; kind: SniffedKind } | { ok: false; message: string }

/**
 * After the file arrives and before it is handed to the device: is it really a PDF, a picture or plain text, and does its
 * name say the same? If not, nothing is saved.
 */
export function checkDownloaded(input: { name: string; bytes: Uint8Array }): SaveVerdict {
  const name = cleanSaveName(input.name)
  const parts = name.split('.').slice(1)
  if (parts.some(p => PROGRAM.test(p))) return { ok: false, message: 'That file is a program or script. Alpha does not download those.' }
  const kind = sniffFile(input.bytes)
  if (!kind) return { ok: false, message: `${FILE_WORDS} This file is something else, so it was not saved.` }
  let ext = fileExtension(name)
  if (ext && !KIND_EXT[kind].includes(ext)) {
    return { ok: false, message: 'The file does not match its name, so it was not saved.' }
  }
  let finalName = name
  if (!ext) {
    ext = KIND_EXT[kind][0]
    finalName = `${name.replace(/\.+$/, '')}.${ext}`
  }
  return { ok: true, name: finalName, mime: FILE_TYPES[ext], kind }
}

/** "1.2 MB", "340 KB". */
export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} bytes`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The file name the server put in its answer ("attachment; filename=..."), or an empty string. */
export function nameFromDisposition(header: string | null | undefined): string {
  const h = String(header || '')
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(h)
  if (star) {
    try { return decodeURIComponent(star[1].trim()).slice(0, 160) } catch { /* fall through to the plain name */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(h)
  return plain ? plain[1].trim().slice(0, 160) : ''
}
