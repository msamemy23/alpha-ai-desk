/**
 * Shared call state store — used by both the webhook handler and call-summary route.
 * Module-level singleton persists across requests within the same serverless instance.
 */

export interface CallState {
  task:         string
  conversation: Array<{ role: string; content: string }>
  transcript:   Array<{ speaker: string; text: string }>
  greeted:      boolean
  processing:   boolean
  startedAt:    number
  status:       string
  summary?:     string
}

// Global singleton — persists for the lifetime of the serverless instance
export const callStateStore = new Map<string, CallState>()
