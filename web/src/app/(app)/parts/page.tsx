'use client'
import { useState } from 'react'
import { formatCurrency } from '@/lib/supabase'

interface PartResult {
  name: string
  brand: string
  partNumber: string
  price: number
  source: string
  inStock: boolean
  notes: string
}

export default function PartsLookupPage() {
  const [query, setQuery] = useState(')
  const [vehicle, setVehicle] = useState({ year: ', make: ', model: ' })
  const [results, setResults] = useState<PartResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query) return
    setLoading(true); setSearched(true)
    try {
      const { data: settings } = await (await import('@/lib/supabase')).supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = (settings?.ai_api_key as string) || '
      const model = (settings?.ai_model as string) || 'meta-llama/llama-3.3-70b-instruct:free'
      const baseUrl = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'

      if (!apiKey) {
        setResults([])
        alert('Configure your AI API key in Settings first.')
        return
      }

      const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
      const prompt = `You are a parts lookup assistant for an auto repair shop. The user is looking for: "${query}"${vehicleStr ? ` for a ${vehicleStr}` : '}.

Return a JSON array of 3-5 common part options with realistic pricing. Each object should have: name, brand, partNumber, price (number), source (e.g. "AutoZone", "O'Reilly", "RockAuto", "Dealer"), inStock (boolean), notes (brief). Return ONLY the JSON array, no markdown.`

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
        })
      })
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content || '[]'
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        setResults(JSON.parse(jsonMatch[0]))
      } else {
        setResults([])
      }
    } catch { setResults([]) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in max-w-4xl">
      <h1 className="text-xl sm:text-2xl font-bold mb-6">Parts Lookup</h1>

      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <input className="form-input" placeholder="Year" value={vehicle.year} onChange={e => setVehicle(v => ({ ...v, year: e.target.value }))} />
          <input className="form-input" placeholder="Make" value={vehicle.make} onChange={e => setVehicle(v => ({ ...v, make: e.target.value }))} />
          <input className="form-input" placeholder="Model" value={vehicle.model} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} />
        </div>
        <div className="flex gap-3">
          <input
            className="form-input flex-1"
            placeholder="Search for a part (e.g., brake pads, alternator, oil filter)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }}
          />
          <button className="btn btn-primary" onClick={search} disabled={loading || !query}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {searched && !loading && results.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <div className="text-4xl mb-3">🔩</div>
          <p>No results found. Try a different search term.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((p, i) => (
            <div key={i} className="card flex items-center gap-4">
              <div className="flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-text-muted">{p.brand} · {p.partNumber}</div>
                {p.notes && <div className="text-xs text-text-muted mt-1">{p.notes}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold text-green">{formatCurrency(p.price)}</div>
                <div className="text-xs text-text-muted">{p.source}</div>
                <span className={`tag text-xs mt-1 ${p.inStock ? 'tag-green' : 'tag-red'}`}>
                  {p.inStock ? 'In Stock' : 'Order'}
                </span>
              </div>
            </div>
          ))}
          <div className="text-xs text-text-muted text-center mt-4">
            Prices are AI-estimated. Verify with supplier before ordering.
          </div>
        </div>
      )}
    </div>
  )
}
