import type { SupabaseClient } from '@supabase/supabase-js'

/** The SSR browser client automatically consumes the one-use PKCE code. */
export async function getCallbackSession(auth: Pick<SupabaseClient['auth'], 'initialize' | 'getSession'>) {
  const { error: initializationError } = await auth.initialize()
  if (initializationError) throw initializationError
  const { data, error } = await auth.getSession()
  if (error) throw error
  if (!data.session) {
    throw new Error('Sign-in did not create a session. Try again in the same browser where you started sign-in.')
  }
  return data.session
}
