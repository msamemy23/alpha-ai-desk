import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+17134001234'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''

async function generateFollowUpMessage(customerName: string, lastService: string, monthsAgo: number): Promise<string> {
  if (!OPENAI_API_KEY) {
    const templates = [
      `Hey ${customerName}! It's been a while since your last visit to Alpha International Auto Center. Time for a checkup? Call us at (713) 663-6979!`,
      `Hi ${customerName}, we miss you at Alpha International! Your ${lastService} was ${monthsAgo} months ago. Let's make sure your car is running great - call (713) 663-6979!`,
      `${customerName}, your car deserves some love! It's been ${monthsAgo} months since your ${lastService}. Schedule your next service at Alpha International: (713) 663-6979`
    ]
    return templates[Math.floor(Math.random() * templates.length)]
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'You are a friendly auto shop assistant for Alpha International Auto Center in Houston. Write a short, warm follow-up text message (under 160 chars) to a past customer. Include the shop phone: (713) 663-6979. Be personal but professional.'
        }, {
          role: 'user',
          content: `Customer: ${customerName}. Last service: ${lastService}, ${monthsAgo} months ago. Write a follow-up text.`
        }],
        max_tokens: 100,
        temperature: 0.8
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || `Hey ${customerName}! It's been a while. Time for a checkup at Alpha International? Call (713) 663-6979!`
  } catch {
    return `Hey ${customerName}! Time for a checkup at Alpha International Auto Center? Call us: (713) 663-6979!`
  }
}

async function sendSMS(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!TELNYX_API_KEY) {
    return { success: false, error: 'Telnyx API key not configured' }
  }

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TELNYX_API_KEY}`
      },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
        to: to,
        text: message
      })
    })
    const data = await res.json()
    if (data.data?.id) {
      return { success: true, messageId: data.data.id }
    }
    return { success: false, error: data.errors?.[0]?.detail || 'Failed to send' }
  } catch (e: unknown) {
    const err = e as Error
    return { success: false, error: err.message }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { months_threshold = 6, dry_run = false } = body

    // Find customers who haven't visited in X months
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - months_threshold)

    // Get customers with their last invoice date
    const { data: customers, error: custError } = await supabase
      .from('customers')
      .select('id, name, phone, email')

    if (custError) throw custError

    // Get invoices to find last visit per customer
    const { data: invoices, error: invError } = await supabase
      .from('invoices')
      .select('customer_id, created_at, items')
      .order('created_at', { ascending: false })

    if (invError) throw invError

    // Build map of last visit per customer
    const lastVisit: Record<string, { date: string; service: string }> = {}
    for (const inv of invoices || []) {
      if (!lastVisit[inv.customer_id]) {
        const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items
        const serviceName = Array.isArray(items) && items.length > 0 
          ? (items[0].description || items[0].name || 'service') 
          : 'service'
        lastVisit[inv.customer_id] = { date: inv.created_at, service: serviceName }
      }
    }

    // Filter customers who haven't been back
    const staleCustomers = (customers || []).filter(c => {
      const visit = lastVisit[c.id]
      if (!visit) return false // No invoice history
      return new Date(visit.date) < cutoffDate
    })

    const results: Array<{
      customer: string
      phone: string
      message: string
      sent: boolean
      messageId?: string
      error?: string
      months_since_visit: number
      last_service: string
    }> = []

    for (const customer of staleCustomers) {
      const visit = lastVisit[customer.id]
      const monthsAgo = Math.floor((Date.now() - new Date(visit.date).getTime()) / (1000 * 60 * 60 * 24 * 30))
      
      const message = await generateFollowUpMessage(customer.name, visit.service, monthsAgo)
      
      if (dry_run || !customer.phone) {
        results.push({
          customer: customer.name,
          phone: customer.phone || 'N/A',
          message,
          sent: false,
          months_since_visit: monthsAgo,
          last_service: visit.service,
          error: dry_run ? 'Dry run mode' : 'No phone number'
        })
      } else {
        const smsResult = await sendSMS(customer.phone, message)
        
        // Log the follow-up
        await supabase.from('growth_followups').insert({
          customer_id: customer.id,
          customer_name: customer.name,
          phone: customer.phone,
          message,
          sent: smsResult.success,
          message_id: smsResult.messageId || null,
          error: smsResult.error || null,
          months_since_visit: monthsAgo,
          last_service: visit.service,
          created_at: new Date().toISOString()
        })

        results.push({
          customer: customer.name,
          phone: customer.phone,
          message,
          sent: smsResult.success,
          messageId: smsResult.messageId,
          error: smsResult.error,
          months_since_visit: monthsAgo,
          last_service: visit.service
        })
      }
    }

    return NextResponse.json({
      total_stale_customers: staleCustomers.length,
      messages_sent: results.filter(r => r.sent).length,
      messages_failed: results.filter(r => !r.sent).length,
      threshold_months: months_threshold,
      dry_run,
      results
    })
  } catch (e) {
    console.error('Follow-ups error:', e)
    return NextResponse.json({ error: 'Failed to process follow-ups' }, { status: 500 })
  }
}
