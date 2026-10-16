'use client'
import { useParams } from 'next/navigation'
import QuoteView from '@/components/booking/QuoteView'

/** A shop's public "ask for a price" page: /book/<its address>/quote. No sign-in, no shop data in this file. */
export default function QuotePage() {
  const params = useParams<{ slug: string }>()
  const slug = typeof params?.slug === 'string' ? params.slug.toLowerCase() : ''
  return <QuoteView slug={slug} />
}
