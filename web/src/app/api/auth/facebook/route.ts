import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const APP_ID = process.env.FACEBOOK_APP_ID || '1379263117302106'
const CALLBACK = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'

// Using current Facebook Graph API scopes (approved in Developer console)
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'instagram_basic',
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
].join(',')

export async function GET() {
  const url =
    `https://www.facebook.com/v21.0/dialog/oauth` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code`

  return NextResponse.redirect(url)
}
