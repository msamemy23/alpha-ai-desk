import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+17134001234'
const GOOGLE_REVIEW_LINK = 'https://g.page/r/alpha-international-auto-center/review'

async function generateReviewResponse(reviewerName: string, rating: number, reviewText: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    if (rating >= 4) {
      return `Thank you so much, ${reviewerName}! We really appreciate your kind words and are glad we could help. See you next time at Alpha International Auto Center!`
    }
    return `Thank you for your feedback, ${reviewerName}. We take all reviews seriously and would love to make things right. Please call us at (713) 663-6979 so we can address your concerns.`
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'You are the owner of Alpha International Auto Center in Houston. Write a professional, warm response to a Google review. Keep it under 100 words. For positive reviews, thank them warmly. For negative reviews, apologize sincerely and invite them to call (713) 663-6979 to resolve the issue. Never be defensive.'
        }, {
          role: 'user',
          content: `Reviewer: ${reviewerName}\nRating: ${rating}/5 stars\nReview: ${reviewText}\n\nWrite a response.`
        }],
        max_tokens: 150,
        temperature: 0.7
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || `Thank you for your review, ${reviewerName}! We appreciate your feedback.`
  } catch {
    return `Thank you for your review, ${reviewerName}! We appreciate your feedback at Alpha International Auto Center.`
  }
}

async function sendReviewRequestSMS(phone: string, customerName: string): Promise<{ success: boolean; error?: string }> {
  if (!TELNYX_API_KEY) {
    return { success: false, error: 'Telnyx not configured' }
  }

  const message = `Hi ${customerName}! Thank you for choosing Alpha International Auto Center. If you had a great experience, we'd love a Google review! ${GOOGLE_REVIEW_LINK} - It means the world to us!`

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TELNYX_API_KEY}`
      },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
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
    const body = await req.json()
    const { action } = body

    if (action === 'request_review') {
      // Send review request to recent customers
      const { customer_name, customer_phone, customer_id } = body

      if (!customer_phone) {
        return NextResponse.json({ error: 'Customer phone required' }, { status: 400 })
      }

      const result = await sendReviewRequestSMS(customer_phone, customer_name || 'Valued Customer')

      // Log the request
      await supabase.from('growth_review_requests').insert({
        customer_id: customer_id || null,
        customer_name: customer_name || 'Unknown',
        phone: customer_phone,
        sent: result.success,
        error: result.error || null,
        created_at: new Date().toISOString()
      })

      return NextResponse.json({
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

      const { data: recentInvoices } = await supabase
        .from('invoices')
        .select('customer_id')
        .gte('created_at', sevenDaysAgo.toISOString())

      if (!recentInvoices || recentInvoices.length === 0) {
        return NextResponse.json({ message: 'No recent customers found', sent: 0 })
      }

      const customerIds = [...new Set(recentInvoices.map((i: { customer_id: string }) => i.customer_id))]
      const { data: customers } = await supabase
        .from('customers')
        .select('id, name, phone')
        .in('id', customerIds)

      // Check who already got a request recently
      const { data: recentRequests } = await supabase
        .from('growth_review_requests')
        .select('phone')
        .gte('created_at', sevenDaysAgo.toISOString())

      const alreadySent = new Set((recentRequests || []).map((r: { phone: string }) => r.phone))

      let sentCount = 0
      const results: Array<{ name: string; sent: boolean }> = []

      for (const cust of customers || []) {
        if (!cust.phone || alreadySent.has(cust.phone)) continue

        const result = await sendReviewRequestSMS(cust.phone, cust.name)
        
        await supabase.from('growth_review_requests').insert({
          customer_id: cust.id,
          customer_name: cust.name,
          phone: cust.phone,
          sent: result.success,
          error: result.error || null,
          created_at: new Date().toISOString()
        })

        if (result.success) sentCount++
        results.push({ name: cust.name, sent: result.success })
      }

      return NextResponse.json({ sent: sentCount, total: results.length, results })
    }

    if (action === 'respond_to_review') {
      // Generate AI response to a Google review
      const { reviewer_name, rating, review_text } = body

      const response = await generateReviewResponse(
        reviewer_name || 'Customer',
        rating || 5,
        review_text || ''
      )

      // Log it
      await supabase.from('growth_review_responses').insert({
        reviewer_name: reviewer_name || 'Unknown',
        rating: rating || 0,
        review_text: review_text || '',
        ai_response: response,
        posted: false,
        created_at: new Date().toISOString()
      })

      return NextResponse.json({
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
export async function GET() {
  try {
    const { data: requests } = await supabase
      .from('growth_review_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    const { data: responses } = await supabase
      .from('growth_review_responses')
      .select('*')
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
