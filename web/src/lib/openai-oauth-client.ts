import { openaiAuthHeaders } from '@openai-oauth/react'

/**
 * Add request-bound ChatGPT credentials without replacing Alpha AI Desk's
 * Supabase Authorization header. OAuth tokens stay in the browser's
 * encrypted session store and are forwarded only for the request that needs
 * them.
 */
export async function addOpenAIOAuthHeaders(headers: Record<string, string>) {
  try {
    const oauth = await openaiAuthHeaders({ optional: true })
    if (oauth.authorization && oauth['chatgpt-account-id']) {
      headers['x-openai-oauth-authorization'] = oauth.authorization
      headers['x-openai-oauth-account-id'] = oauth['chatgpt-account-id']
      if (oauth['x-openai-fedramp']) headers['x-openai-oauth-fedramp'] = oauth['x-openai-fedramp']
    }
  } catch {
    // A disconnected ChatGPT session should leave the normal shop API-key
    // path untouched.
  }
  return headers
}
