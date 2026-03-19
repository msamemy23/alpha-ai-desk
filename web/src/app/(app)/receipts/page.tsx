'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ReceiptsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/invoices') }, [router])
  return null
}
