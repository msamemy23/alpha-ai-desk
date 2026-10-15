// Handing a checked file to the device, and the other two things the screen does outside the page: copying and
// carrying a question over to Ask Alpha. Each one can fail on a locked-down phone, so each says whether it worked.
import { PREFILL_KEY } from './found.ts'

/** Save bytes as a file. Throws if the device refuses, so the caller can say so. */
export function saveToDevice(file: { name: string; mime: string; bytes: Uint8Array }): void {
  const blob = new Blob([file.bytes as BlobPart], { type: file.mime })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/** Copy text. True if it was copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the older way */ }
  try {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    box.style.left = '-9999px'
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * Put a message in Ask Alpha's box and go there. Ask Alpha fills the message in and waits: it never sends it for you.
 * `go` takes the person to the Ask Alpha screen. Returns false if the device would not keep the note.
 */
export function sendToAskAlpha(message: string, go: (path: string) => void): boolean {
  try {
    localStorage.setItem(PREFILL_KEY, message)
  } catch {
    return false
  }
  go('/ai')
  return true
}
