import { NextRequest, NextResponse } from 'next/server'
import { getConnector, getValidGoogleToken } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

const GCAL = 'https://www.googleapis.com/calendar/v3'

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body

  const connector = await getConnector('google_calendar')
  if (!connector?.enabled) return fail('Google Calendar not connected', 401)

  let token: string
  try {
    token = await getValidGoogleToken(connector)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Token error', 401)
  }

  try {
    switch (action) {

      // ── List upcoming events ──────────────────────────────────────
      case 'list_events': {
        const { days = 7 } = body as { days?: number }
        const now = new Date().toISOString()
        const later = new Date(Date.now() + days * 86400000).toISOString()

        const r = await fetch(
          `${GCAL}/calendars/primary/events` +
          `?timeMin=${encodeURIComponent(now)}` +
          `&timeMax=${encodeURIComponent(later)}` +
          `&orderBy=startTime&singleEvents=true`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
        return ok(await r.json())
      }

      // ── Create an event ───────────────────────────────────────────
      case 'create_event': {
        const { title, start, end, description } = body as {
          title: string
          start: string
          end: string
          description?: string
        }
        if (!title || !start || !end) return fail('title, start, and end required')

        const event: Record<string, unknown> = {
          summary: title,
          start: { dateTime: start, timeZone: 'America/Chicago' },
          end:   { dateTime: end,   timeZone: 'America/Chicago' },
        }
        if (description) event.description = description

        const r = await fetch(`${GCAL}/calendars/primary/events`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        return ok(await r.json())
      }

      // ── Delete an event ───────────────────────────────────────────
      case 'delete_event': {
        const { event_id } = body as { event_id: string }
        if (!event_id) return fail('event_id required')

        const r = await fetch(`${GCAL}/calendars/primary/events/${encodeURIComponent(event_id)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (r.status === 204 || r.ok) return ok({ deleted: true, event_id })
        return ok(await r.json())
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
