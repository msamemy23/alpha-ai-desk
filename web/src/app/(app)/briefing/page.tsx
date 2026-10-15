import { redirect } from 'next/navigation'

// The daily summary and notes live on Today now. This address stays so old bookmarks keep working.
export default function BriefingPage() {
  redirect('/dashboard')
}
