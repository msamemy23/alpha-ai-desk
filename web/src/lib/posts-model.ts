// The shop's own context for repair posts: its name and phone, and the AI call, built the same way the other Get more customers
// routes build it (the shop's own key, base address and model from its settings). Nothing here changes any AI setting or helper.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import type { ModelCall, ShopContext } from '@/lib/posts-source'

export async function loadShopContext(db: SupabaseClient, shopId: string): Promise<ShopContext> {
  const { data, error } = await db.from('settings').select('shop_name,shop_phone,ai_api_key,ai_base_url,ai_model').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('The shop settings could not be loaded.')
  const base = { shopName: String(data?.shop_name || '').trim().slice(0, 120), shopPhone: String(data?.shop_phone || '').trim().slice(0, 40), city: '' }
  const key = String(data?.ai_api_key || '').trim()
  if (!key) return { ...base, model: null }
  const url = normalizeAiBaseUrl(data?.ai_base_url || AI_BASE_URLS.OPENROUTER)
  const modelName = normalizeAiModel(data?.ai_model, url)
  const model: ModelCall = async (system, user) => {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 320, temperature: 0.3 }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`The AI service answered ${res.status}`)
    const out = await res.json().catch(() => ({}))
    return String(out?.choices?.[0]?.message?.content || '')
  }
  return { ...base, model }
}
