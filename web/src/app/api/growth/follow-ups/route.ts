import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'


async function generateFollowUpMessage(customerName: string, lastService: string, monthsAgo: number, shopName: string, shopPhone: string, aiKey: string, aiBase: string, aiModel: string): Promise<string> {
  if (!aiKey) {
    const templates = [
      `Hey ${customerName}! It's been a while since your last visit to ${shopName}. Time for a checkup?${shopPhone ? ` Call us at ${shopPhone}!` : ''}`,
      `Hi ${customerName}, we miss you at ${shopName}! Your ${lastService} was ${monthsAgo} months ago. Let's make sure your car is running great.${shopPhone ? ` Call ${shopPhone}!` : ''}`,
      `${customerName}, your car deserves some love! It's been ${monthsAgo} months since your ${lastService}. Schedule your next service at ${shopName}${shopPhone ? `: ${shopPhone}` : ''}`
    ]
    return templates[Math.floor(Math.random() * templates.length)]
  }

  try {
    const res = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: `You are a friendly auto shop assistant for ${shopName}. Write a short, warm follow-up text message (under 160 chars) to a past customer. ${shopPhone ? `Include the shop phone: ${shopPhone}.` : ''} Be personal but professional.`
        }, {
          role: 'user',
          content: `Customer: ${customerName}. Last service: ${lastService}, ${monthsAgo} months ago. Write a follow-up text.`
        }],
        max_tokens: 100,
        temperature: 0.8
      })
    })
    if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || `Hey ${customerName}! It's been a while. Time for a checkup at ${shopName}${shopPhone ? ` — call ${shopPhone}!` : '!'}`
  } catch {
    return `Hey ${customerName}! Time for a checkup at ${shopName}${shopPhone ? `? Call us: ${shopPhone}!` : '?'}`
  }
}

async function sendSMS(to: string, message: string, apiKey: string, fromNumber: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!apiKey || !fromNumber) {
    return { success: false, error: 'Telnyx API key not configured' }
  }

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: fromNumber,
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
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()

    const rawThreshold = Number(body?.months_threshold ?? 6)
    const monthsThreshold = Number.isFinite(rawThreshold) && rawThreshold >= 1 && rawThreshold <= 60
      ? Math.floor(rawThreshold)
      : 6
    const dryRun = body?.dry_run === true
    const supabase = getServiceClient()
    const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError
    const shopName = String(settings?.shop_name || 'our shop').slice(0, 120)
    const shopPhone = String(settings?.shop_phone || '').slice(0, 40)
    const aiKey = String(settings?.ai_api_key || '')
    const telnyxKey = String(settings?.telnyx_api_key || '')
    const telnyxFrom = String(settings?.telnyx_phone_number || '')
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)

    // Find customers who haven't visited in X months
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsThreshold)

    // Get customers with their last invoice date
    const { data: customers, error: custError } = await supabase
      .from('customers')
      .select('id, name, phone, email')
      .eq('shop_id', auth.shopId)

    if (custError) throw custError

    // Get invoices to find last visit per customer
    const { data: invoices, error: invError } = await supabase
      .from('invoices')
      .select('customer_id, created_at, items')
      .order('created_at', { ascending: false })
      .eq('shop_id', auth.shopId)

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

    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentFollowups, error: recentFollowupsError } = await supabase
      .from('growth_followups')
      .select('customer_id')
      .eq('shop_id', auth.shopId)
      .gte('created_at', recentCutoff)
    if (recentFollowupsError) throw recentFollowupsError
    const recentlyContacted = new Set((recentFollowups || []).map(row => row.customer_id))

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
      if (recentlyContacted.has(customer.id)) continue
      const visit = lastVisit[customer.id]
      const monthsAgo = Math.floor((Date.now() - new Date(visit.date).getTime()) / (1000 * 60 * 60 * 24 * 30))
      
      const message = await generateFollowUpMessage(customer.name, visit.service, monthsAgo, shopName, shopPhone, aiKey, aiBase, aiModel)
      
      if (dryRun || !customer.phone) {
        results.push({
          customer: customer.name,
          phone: customer.phone || 'N/A',
          message,
          sent: false,
          months_since_visit: monthsAgo,
          last_service: visit.service,
          error: dryRun ? 'Dry run mode' : 'No phone number'
        })
      } else {
        const smsResult = await sendSMS(customer.phone, message, telnyxKey, telnyxFrom)
        
        // Log the follow-up
        await supabase.from('growth_followups').insert({
          shop_id: auth.shopId,
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

    const failed = !dryRun && results.some(result => result.sent !== true)
    const success = dryRun || !failed
    return NextResponse.json({
      ok: success,
      success,
      total_stale_customers: staleCustomers.length,
      messages_sent: results.filter(r => r.sent).length,
      messages_failed: results.filter(r => !r.sent).length,
      threshold_months: monthsThreshold,
      dry_run: dryRun,
      results
    }, { status: success ? 200 : 502 })
  } catch (e) {
    console.error('Follow-ups error:', e)
    return NextResponse.json({ error: 'Failed to process follow-ups' }, { status: 500 })
  }
}
