'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface LineItem {
  description: string
  qty?: number
  unit_price?: number
  unitPrice?: number
  total?: number
  taxable?: boolean
}

interface Doc {
  id: string
  type: string
  doc_number: string
  customer_name: string
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  vehicle_vin?: string
  doc_date?: string
  total?: number
  notes?: string
  line_items?: LineItem[]
  warranty_type?: string
  warranty_months?: number
  warranty_mileage?: number
  warranty_exclusions?: string
  warranty_start?: string
}

const LOGO_URL = '/alpha-bot.jpg'

export default function SignPage() {
  const params = useParams()
  const token = params?.token as string

  const [state, setState] = useState<'loading'|'ready'|'already_signed'|'expired'|'error'|'signing'|'done'>('loading')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [signerName, setSignerName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [signedAt, setSignedAt] = useState('')
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    fetch('/api/sign?token=' + token)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          if (data.error.includes('expired')) setState('expired')
          else setState('error')
          setErrorMsg(data.error)
        } else if (data.already_signed) {
          setState('already_signed')
          setSignedAt(data.signed_at)
        } else {
          setDoc(data.doc)
          setState('ready')
        }
      })
      .catch(() => { setState('error'); setErrorMsg('Failed to load document') })
  }, [token])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    setIsDrawing(true)
    lastPos.current = getPos(e, canvas)
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(lastPos.current?.x ?? pos.x, lastPos.current?.y ?? pos.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
    setHasSignature(true)
  }, [isDrawing])

  const endDraw = useCallback(() => {
    setIsDrawing(false)
    lastPos.current = null
  }, [])

  const clearSig = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  const handleSubmit = async () => {
    if (!signerName.trim()) { alert('Please enter your full name to sign.'); return }
    if (!hasSignature) { alert('Please draw your signature in the box.'); return }
    if (!agreed) { alert('Please check the agreement box to proceed.'); return }
    const canvas = canvasRef.current
    const signatureData = canvas?.toDataURL('image/png') || ''
    setState('signing')
    try {
      const res = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', token, signatureData, signerName: signerName.trim() }),
      })
      const data = await res.json()
      if (data.success) { setState('done'); setSignedAt(data.signed_at) }
      else { setState('ready'); alert(data.error || 'Failed to save signature. Please try again.') }
    } catch { setState('ready'); alert('Network error. Please try again.') }
  }

  const vehicle = doc ? [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') : ''
  const lineItems = doc?.line_items || []
  const total = Number(doc?.total || 0)

  const boxStyle: React.CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb', padding: '16px 20px', marginBottom: 12 }
  const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 2 }

  // Centered status pages
  if (state === 'loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontFamily:'Arial,Helvetica,sans-serif'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:36,height:36,border:'3px solid #e5e7eb',borderTopColor:'#2563eb',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 12px'}} />
        <p style={{color:'#6b7280',fontSize:14}}>Loading document...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  if (state === 'already_signed') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontFamily:'Arial,Helvetica,sans-serif',padding:20}}>
      <div style={{textAlign:'center',maxWidth:400}}>
        <img src={LOGO_URL} alt="Logo" style={{width:60,height:60,borderRadius:'50%',margin:'0 auto 16px',display:'block',objectFit:'cover'}} />
        <div style={{fontSize:40,marginBottom:8}}>✅</div>
        <h2 style={{fontSize:20,fontWeight:700,color:'#111',margin:'0 0 4px'}}>Already Signed</h2>
        <p style={{fontSize:13,color:'#6b7280'}}>This document was signed on {new Date(signedAt).toLocaleString()}.</p>
        <p style={{fontSize:12,color:'#9ca3af',marginTop:8}}>Check your email for your signed confirmation.</p>
      </div>
    </div>
  )

  if (state === 'expired' || state === 'error') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontFamily:'Arial,Helvetica,sans-serif',padding:20}}>
      <div style={{textAlign:'center',maxWidth:400}}>
        <img src={LOGO_URL} alt="Logo" style={{width:60,height:60,borderRadius:'50%',margin:'0 auto 16px',display:'block',objectFit:'cover'}} />
        <div style={{fontSize:40,marginBottom:8}}>{state === 'expired' ? '⏰' : '❌'}</div>
        <h2 style={{fontSize:20,fontWeight:700,color:'#111',margin:'0 0 4px'}}>{state === 'expired' ? 'Link Expired' : 'Link Not Found'}</h2>
        <p style={{fontSize:13,color:'#6b7280'}}>{errorMsg || 'This signing link is no longer valid.'}</p>
        <p style={{fontSize:12,color:'#9ca3af',marginTop:8}}>Please contact the shop for a new link.</p>
      </div>
    </div>
  )

  if (state === 'done') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontFamily:'Arial,Helvetica,sans-serif',padding:20}}>
      <div style={{textAlign:'center',maxWidth:400}}>
        <img src={LOGO_URL} alt="Logo" style={{width:60,height:60,borderRadius:'50%',margin:'0 auto 16px',display:'block',objectFit:'cover'}} />
        <div style={{fontSize:40,marginBottom:8}}>🎉</div>
        <h2 style={{fontSize:20,fontWeight:700,color:'#111',margin:'0 0 4px'}}>Signature Complete!</h2>
        <p style={{fontSize:13,color:'#6b7280'}}>Thank you, <strong>{signerName}</strong>!</p>
        <p style={{fontSize:12,color:'#9ca3af',marginTop:4}}>Signed: {new Date(signedAt).toLocaleString()}</p>
        <p style={{fontSize:11,color:'#9ca3af',marginTop:8}}>A confirmation has been emailed to you.</p>
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc',fontFamily:'Arial,Helvetica,sans-serif',padding:'16px 12px'}}>
      <div style={{maxWidth:640,margin:'0 auto'}}>
        {/* Header with logo */}
        <div style={{textAlign:'center',marginBottom:16}}>
          <img src={LOGO_URL} alt="Alpha International Auto Center" style={{width:56,height:56,borderRadius:'50%',margin:'0 auto 8px',display:'block',objectFit:'cover',border:'2px solid #e5e7eb'}} />
          <h1 style={{fontSize:16,fontWeight:700,color:'#1a1a2e',margin:'0 0 2px'}}>Alpha International Auto Center</h1>
          <p style={{fontSize:10,color:'#9ca3af',margin:0}}>10710 S Main St, Houston TX 77025 &middot; (713) 663-6979</p>
          <p style={{fontSize:10,color:'#6b7280',margin:'4px 0 0',fontWeight:600}}>Electronic Signature Request</p>
        </div>

        {/* Document info card */}
        <div style={boxStyle}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={labelStyle}>{doc?.type}</div>
              <div style={{fontSize:18,fontWeight:800,color:'#111'}}>#{doc?.doc_number}</div>
              {vehicle && <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>🚗 {vehicle}</div>}
              <div style={{fontSize:12,color:'#374151',marginTop:4}}>Customer: <strong>{doc?.customer_name}</strong></div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={labelStyle}>Total</div>
              <div style={{fontSize:22,fontWeight:800,color:'#111'}}>${total.toFixed(2)}</div>
              <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>{doc?.doc_date}</div>
            </div>
          </div>
        </div>

        {/* Line items */}
        {lineItems.length > 0 && (
          <div style={boxStyle}>
            <div style={{...labelStyle, marginBottom:8}}>Services & Parts</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{borderBottom:'1px solid #e5e7eb'}}>
                  <th style={{textAlign:'left',padding:'4px 0',fontSize:10,fontWeight:600,color:'#9ca3af',textTransform:'uppercase'}}>Description</th>
                  <th style={{textAlign:'center',padding:'4px 0',fontSize:10,fontWeight:600,color:'#9ca3af',width:40}}>Qty</th>
                  <th style={{textAlign:'right',padding:'4px 0',fontSize:10,fontWeight:600,color:'#9ca3af',width:70}}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, i) => (
                  <tr key={i} style={{borderBottom:'1px solid #f3f4f6'}}>
                    <td style={{padding:'6px 0',color:'#374151'}}>{item.description}</td>
                    <td style={{padding:'6px 0',textAlign:'center',color:'#6b7280'}}>{item.qty || 1}</td>
                    <td style={{padding:'6px 0',textAlign:'right',fontWeight:600,color:'#111'}}>${(item.total || (Number(item.qty||1)*Number(item.unitPrice||item.unit_price||0))).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{borderTop:'2px solid #111'}}>
                  <td colSpan={2} style={{padding:'8px 0',fontWeight:700,fontSize:13}}>Total</td>
                  <td style={{padding:'8px 0',textAlign:'right',fontWeight:700,fontSize:13}}>${total.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Notes */}
        {doc?.notes && (
          <div style={boxStyle}>
            <div style={labelStyle}>Notes</div>
            <p style={{fontSize:12,color:'#374151',margin:'4px 0 0',whiteSpace:'pre-wrap'}}>{doc.notes}</p>
          </div>
        )}

        {/* Warranty */}
        {doc?.warranty_type && doc.warranty_type !== 'No Warranty' && (
          <div style={{...boxStyle, borderColor:'#3b82f6',background:'#eff6ff'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
              <span style={{fontSize:14}}>🛡️</span>
              <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',color:'#1e40af'}}>Warranty: {doc.warranty_type}</span>
            </div>
            <div style={{fontSize:11,color:'#374151'}}>
              {doc.warranty_months ? doc.warranty_months + ' months' : ''}
              {doc.warranty_months && doc.warranty_mileage ? ' / ' : ''}
              {doc.warranty_mileage ? doc.warranty_mileage.toLocaleString() + ' miles' : ''}
              {doc.warranty_start ? ' from ' + doc.warranty_start : ''}
            </div>
            {doc.warranty_exclusions && (
              <details style={{marginTop:6}}>
                <summary style={{fontSize:10,color:'#2563eb',cursor:'pointer',fontWeight:600}}>View Full Warranty Terms</summary>
                <p style={{fontSize:10,color:'#6b7280',marginTop:4,lineHeight:1.4,whiteSpace:'pre-wrap'}}>{doc.warranty_exclusions}</p>
              </details>
            )}
          </div>
        )}

        {/* Signature section */}
        <div style={{...boxStyle, borderColor:'#2563eb'}}>
          <div style={{...labelStyle, marginBottom:10, color:'#2563eb', fontSize:11}}>✍️ Sign Below</div>

          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,fontWeight:600,color:'#374151',display:'block',marginBottom:4}}>Full Legal Name</label>
            <input type="text" value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Type your full name" style={{width:'100%',border:'1.5px solid #d1d5db',borderRadius:8,padding:'10px 12px',fontSize:14,color:'#111827',boxSizing:'border-box',outline:'none'}} />
          </div>

          <div style={{marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <label style={{fontSize:12,fontWeight:600,color:'#374151'}}>Draw Your Signature</label>
              <button onClick={clearSig} style={{fontSize:11,color:'#dc2626',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Clear</button>
            </div>
            <canvas ref={canvasRef} width={600} height={150}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
              style={{width:'100%',height:120,border:'2px dashed #d1d5db',borderRadius:8,background:'#fafafa',cursor:'crosshair',touchAction:'none'}}
            />
            {!hasSignature && <p style={{textAlign:'center',fontSize:11,color:'#9ca3af',margin:'4px 0 0'}}>Sign here with mouse or finger</p>}
          </div>

          <label style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:14,cursor:'pointer'}}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{width:16,height:16,marginTop:2,accentColor:'#2563eb',flexShrink:0}} />
            <span style={{fontSize:11,color:'#374151',lineHeight:1.4}}>I, <strong>{signerName || '[Your Name]'}</strong>, agree that this electronic signature is the legal equivalent of my handwritten signature. I accept the services, charges, and warranty terms on this {doc?.type}.</span>
          </label>

          <button onClick={handleSubmit} disabled={state === 'signing'}
            style={{width:'100%',padding:'12px 0',background:state === 'signing' ? '#9ca3af' : '#2563eb',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:state === 'signing' ? 'not-allowed' : 'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {state === 'signing' ? (<><div style={{width:16,height:16,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />Saving...</>) : '✅ Sign & Submit'}
          </button>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>

        {/* Footer */}
        <div style={{textAlign:'center',fontSize:10,color:'#9ca3af',padding:'8px 0 20px'}}>
          Alpha International Auto Center &middot; Houston, TX &middot; Official Electronic Document
        </div>
      </div>
    </div>
  )
}
