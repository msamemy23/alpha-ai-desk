import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1736123851-r05fmhp9eb9pv7cn3t7joihcdjf1tl0m.apps.googleusercontent.com'
const CALLBACK  = 'https://alpha-ai-desk.vercel.app/api/auth/google/callback'

const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  // optional ?scope=calendar or ?scope=business to restrict
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`

  return NextResponse.redirect(url)
}
