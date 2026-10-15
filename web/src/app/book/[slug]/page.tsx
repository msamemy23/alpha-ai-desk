'use client'
import { useParams } from 'next/navigation'
import BookingView from '@/components/booking/BookingView'

/** A shop's public booking page: /book/<its address>. No sign-in, no shop data in this file. */
export default function BookPage() {
  const params = useParams<{ slug: string }>()
  const slug = typeof params?.slug === 'string' ? params.slug.toLowerCase() : ''
  return <BookingView slug={slug} />
}
