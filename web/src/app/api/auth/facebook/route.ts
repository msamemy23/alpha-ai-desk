import { NextResponse } from 'next/server'

const APP_ID = process.env.FACEBOOK_APP_ID || '1379263117302106'
const CALLBACK = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'

const SCOPES = [
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_manage_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_content_publish',
  'public_profile',
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
