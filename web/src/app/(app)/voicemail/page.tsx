import { redirect } from 'next/navigation'

// Calls, recordings, transcripts and AI summaries all live in the Inbox now. This address stays so old bookmarks keep working.
export default function VoicemailPage() {
  redirect('/messages?tab=calls')
}
