'use client'
import { supabase } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'

/** Request headers for the Settings screens' own calls: JSON, the signed-in session, and any ChatGPT sign-in. */
export async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch { /* the request goes without it and the server says so */ }
  return addOpenAIOAuthHeaders(headers)
}

export function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

/** A status as a lamp and a word, never colour alone. */
export function StatusLine({ lamp, children }: { lamp: 'green' | 'amber' | 'red' | 'blue' | 'off'; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
      <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
      {children}
    </p>
  )
}
