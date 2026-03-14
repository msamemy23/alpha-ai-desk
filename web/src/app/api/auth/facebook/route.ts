import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const APP_ID = process.env.FACEBOOK_APP_ID || '1379263117302106'
const CALLBACK = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'

// Only use scopes that are valid in Facebook Development Mode (no App Review needed)
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_content_publish',
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
