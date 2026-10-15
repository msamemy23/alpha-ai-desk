/** A POST to one of our own routes, with the answer in plain words when it goes wrong. */
export async function postApi(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ ok: boolean; error?: string; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || data.ok === false) return { ok: false, error: typeof data.error === 'string' ? data.error : res.status === 401 ? 'You were signed out. Refresh the page and sign in again.' : 'That did not work. Try again.', data }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'No connection. Check your internet and try again.', data: {} }
  }
}
