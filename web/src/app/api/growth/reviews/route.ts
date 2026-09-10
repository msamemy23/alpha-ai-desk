import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { isSmsOptedOut } from '@/lib/sms-consent'


async function generateReviewResponse(reviewerName: string, rating: number, reviewText: string, shopName: string, shopPhone: string, aiKey: string, aiBase: string, aiModel: string): Promise<string> {
  if (!aiKey) {
    if (rating >= 4) {
      return `Thank you so much, ${reviewerName}! We really appreciate your kind words and are glad we could help. See you next time at ${shopName}!`
    }
    return `Thank you for your feedback, ${reviewerName}. We take all reviews seriously and would love to make things right. Please call us at ${shopPhone} so we can address your concerns.`
  }

  try {
    const res = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: 'You are the owner of ' + shopName + '. Write a professional, warm response to a Google review. Keep it under 100 words. For positive reviews, thank them warmly. For negative reviews, apologize sincerely and invite them to call ' + (shopPhone || 'the shop') + ' to resolve the issue. Never be defensive.'
        }, {
          role: 'user',
          content: `Reviewer: ${reviewerName}\nRating: ${rating}/5 stars\nReview: ${reviewText}\n\nWrite a response.`
        }],
        max_tokens: 150,
        temperature: 0.7
      })
    })
    if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || `Thank you for your review, ${reviewerName}! We appreciate your feedback.`
  } catch {
    return `Thank you for your review, ${reviewerName}! We appreciate your feedback at ${shopName}.`
  }
}

async function sendReviewRequestSMS(phone: string, customerName: string, shopName: string, reviewLink: string, apiKey: string, fromNumber: string, idempotencyKey?: string): Promise<{ success: boolean; error?: string }> {
  if (!apiKey || !fromNumber) {
    return { success: false, error: 'Telnyx not configured' }
  }

  const message = `Hi ${customerName}! Thank you for choosing ${shopName}. If you had a great experience, we'd love a Google review!${reviewLink ? ` ${reviewLink}` : ''} It means the world to us!`

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify({
        from: fromNumber,
        to: phone,
        text: message
      })
    })
    const data = await res.json()
    return data.data?.id ? { success: true } : { success: false, error: data.errors?.[0]?.detail || 'Failed' }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// POST - Ask for reviews or generate AI responses to reviews
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Unable to load shop settings' }, { status: 500 })
    const shopName = String(settings?.shop_name || settings?.company_name || settings?.business_name || 'your shop').slice(0, 120)
    const shopPhone = String(settings?.shop_phone || settings?.phone || settings?.business_phone || '').slice(0, 40)
    const reviewLink = String(settings?.google_review_url || settings?.google_review_link || '').slice(0, 500)
    const telnyxKey = String(settings?.telnyx_api_key || '')
    const telnyxFrom = String(settings?.telnyx_phone_number || '')
    const aiKey = String(settings?.ai_api_key || '')
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)
    const { action } = body || {}

    if (action === 'request_review') {
      // Send review request to recent customers
      const { customer_name, customer_phone, customer_id } = body
      if (customer_id) {
        const { data: customer } = await supabase.from('customers').select('id, name, phone, sms_opted_out').eq('id', customer_id).eq('shop_id', auth.shopId).maybeSingle()
        if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
        if (customer.sms_opted_out) return NextResponse.json({ ok: false, success: false, error: 'Customer has opted out of SMS' }, { status: 409 })
      }

      if (typeof customer_phone !== 'string' || !customer_phone.trim()) {
        return NextResponse.json({ error: 'Customer phone required' }, { status: 400 })
      }
      if (await isSmsOptedOut(supabase, auth.shopId, customer_phone)) {
        return NextResponse.json({ ok: false, success: false, error: 'This destination has opted out of SMS' }, { status: 409 })
      }

      const result = await sendReviewRequestSMS(customer_phone, customer_name || 'Valued Customer', shopName, reviewLink, telnyxKey, telnyxFrom, customer_id ? `review-request-${customer_id}` : undefined)

      // Log the request
      const { error: requestError } = await supabase.from('growth_review_requests').insert({
        shop_id: auth.shopId,
        customer_id: customer_id || null,
        customer_name: customer_name || 'Unknown',
        phone: customer_phone,
        sent: result.success,
        error: result.error || null,
        created_at: new Date().toISOString()
      })
      if (requestError) throw requestError

      return NextResponse.json({
        ok: result.success,
        success: result.success,
        sent: result.success,
        customer: customer_name,
        error: result.error,
        message: result.success
          ? `Review request sent to ${customer_name} at ${customer_phone}`
          : `Failed to send: ${result.error}`
      })
    }

    if (action === 'bulk_request') {
      // Send review requests to all customers from last 7 days
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const { data: recentInvoices, error: recentInvoicesError } = await supabase
        .from('documents')
        .select('customer_id')
        .eq('shop_id', auth.shopId)
        .in('type', ['Invoice', 'Receipt'])
        .neq('status', 'Void')
        .gte('created_at', sevenDaysAgo.toISOString())
      if (recentInvoicesError) return NextResponse.json({ ok: false, error: 'Unable to load recent invoices' }, { status: 500 })

      if (!recentInvoices || recentInvoices.length === 0) {
        return NextResponse.json({ ok: true, success: true, message: 'No recent customers found', sent: 0 })
      }

      const customerIds = [...new Set(recentInvoices.map((i: { customer_id: string }) => i.customer_id).filter(Boolean))]
      if (customerIds.length === 0) return NextResponse.json({ ok: true, success: true, message: 'No recent customers found', sent: 0 })
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, name, phone, sms_opted_out')
        .eq('shop_id', auth.shopId)
        .in('id', customerIds)
      if (customersError) return NextResponse.json({ ok: false, error: 'Unable to load customers' }, { status: 500 })

      // Check who already got a request recently
      const { data: recentRequests, error: recentRequestsError } = await supabase
        .from('growth_review_requests')
        .select('phone')
        .eq('shop_id', auth.shopId)
        .gte('created_at', sevenDaysAgo.toISOString())
      if (recentRequestsError) return NextResponse.json({ ok: false, error: 'Unable to load review request history' }, { status: 500 })

      const alreadySent = new Set((recentRequests || []).map((r: { phone: string }) => r.phone))

      let sentCount = 0
      const results: Array<{ name: string; sent: boolean; skipped?: boolean; error?: string }> = []

      for (const cust of customers || []) {
        if (!cust.phone || alreadySent.has(cust.phone)) continue
        if (cust.sms_opted_out || await isSmsOptedOut(supabase, auth.shopId, cust.phone)) {
          results.push({ name: cust.name, sent: false, skipped: true, error: 'Customer has opted out of SMS' })
          continue
        }

        const result = await sendReviewRequestSMS(cust.phone, cust.name, shopName, reviewLink, telnyxKey, telnyxFrom, `review-request-${cust.id}`)
        
        const { error: bulkRequestError } = await supabase.from('growth_review_requests').insert({
          shop_id: auth.shopId,
          customer_id: cust.id,
          customer_name: cust.name,
          phone: cust.phone,
          sent: result.success,
          error: result.error || null,
          created_at: new Date().toISOString()
        })
        if (bulkRequestError) throw bulkRequestError

        if (result.success) sentCount++
        results.push({ name: cust.name, sent: result.success })
      }

      const success = results.every(result => result.skipped || result.sent === true)
      return NextResponse.json({ ok: success, success, sent: sentCount, total: results.length, results }, { status: success ? 200 : 502 })
    }

    if (action === 'check_and_respond') {
      return NextResponse.json({
        ok: false,
        success: false,
        error: 'Automatic review fetching is not connected for this shop. Supply a review through the Google Business connector before generating a response; nothing was posted.',
      }, { status: 409 })
    }
    if (action === 'respond_to_review') {
      // Generate AI response to a Google review
      const { reviewer_name, rating, review_text } = body

      const response = await generateReviewResponse(
        reviewer_name || 'Customer',
        Math.min(5, Math.max(1, Number(rating) || 5)),
        typeof review_text === 'string' ? review_text.slice(0, 5000) : '',
        shopName,
        shopPhone,
        aiKey,
        aiBase,
        aiModel
      )

      // Log it
      const { error: responseError } = await supabase.from('growth_review_responses').insert({
        shop_id: auth.shopId,
        reviewer_name: reviewer_name || 'Unknown',
        rating: rating || 0,
        review_text: review_text || '',
        ai_response: response,
        posted: false,
        created_at: new Date().toISOString()
      })
      if (responseError) throw responseError

      return NextResponse.json({
        ok: true,
        success: true,
        posted: false,
        response,
        reviewer: reviewer_name,
        rating,
        message: 'AI response generated. Copy and paste it as your reply on Google.'
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    console.error('Reviews error:', e)
    return NextResponse.json({ error: 'Failed to process review action' }, { status: 500 })
  }
}

// GET - Get review request history and stats
export async function GET(req: NextRequest) {
  try {
    const auth = await getRouteShop(req, new URL(req.url).searchParams.get('shop_id'))
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const { data: requests } = await supabase
      .from('growth_review_requests')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('created_at', { ascending: false })
      .limit(50)

    const { data: responses } = await supabase
      .from('growth_review_responses')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('created_at', { ascending: false })
      .limit(50)

    const totalSent = (requests || []).filter((r: { sent: boolean }) => r.sent).length

    return NextResponse.json({
      review_requests: requests || [],
      review_responses: responses || [],
      stats: {
        total_requests_sent: totalSent,
        total_responses_generated: (responses || []).length
      }
    })
  } catch (e) {
    console.error('Reviews GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch review data' }, { status: 500 })
  }
}
