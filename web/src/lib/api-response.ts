import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR'

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init)
}

export function apiFail(error: string, status = 400, code: ApiErrorCode = 'BAD_REQUEST', details?: unknown) {
  return NextResponse.json({ ok: false, error, code, details }, { status })
}

export async function readJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(req: Request) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false as const, error: 'Request body must be a JSON object', body: null }
    }
    return { ok: true as const, body: body as T }
  } catch {
    return { ok: false as const, error: 'Invalid JSON body', body: null }
  }
}

export function requireString(body: Record<string, unknown>, key: string, label = key) {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false as const, error: `${label} is required` }
  }
  return { ok: true as const, value: value.trim() }
}

export function optionalStringArray(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (value === undefined || value === null) return { ok: true as const, value: undefined }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return { ok: false as const, error: `${key} must be an array of strings` }
  }
  return { ok: true as const, value: value.map(String) }
}

export function getIdempotencyKey(req: Request, fallbackParts: Array<string | undefined | null>) {
  const header = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key')
  if (header?.trim()) return header.trim().slice(0, 160)
  return fallbackParts.filter(Boolean).join(':').slice(0, 160)
}
