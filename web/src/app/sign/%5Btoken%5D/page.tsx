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

  if (state === 'loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:40,height:40,border:'4px solid #2563eb',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 12px'}} />
        <p style={{color:'#6b7280'}}>Loading document…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  if (state === 'already_signed') return (
    <div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,.1)',padding:40,maxWidth:440,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:56}}>✅</div>
        <h1 style={{fontSize:22,fontWeight:700,color:'#111827',margin:'12px 0 8px'}}>Already Signed</h1>
        <p style={{color:'#6b7280'}}>This document was signed on {new Date(signedAt).toLocaleString()}.</p>
        <p style={{color:'#9ca3af',fontSize:13,marginTop:12}}>Check your email for your signed confirmation.</p>
      </div>
    </div>
  )

  if (state === 'expired' || state === 'error') return (
    <div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,.1)',padding:40,maxWidth:440,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:56}}>{state === 'expired' ? '⏰' : '❌'}</div>
        <h1 style={{fontSize:22,fontWeight:700,color:'#111827',margin:'12px 0 8px'}}>{state === 'expired' ? 'Link Expired' : 'Link Not Found'}</h1>
        <p style={{color:'#6b7280'}}>{errorMsg || 'This signing link is no longer valid.'}</p>
        <p style={{color:'#9ca3af',fontSize:13,marginTop:12}}>Please contact the shop for a new link.</p>
      </div>
    </div>
  )

  if (state === 'done') return (
    <div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,.1)',padding:40,maxWidth:440,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:64}}>🎉</div>
        <h1 style={{fontSize:24,fontWeight:700,color:'#16a34a',margin:'12px 0 8px'}}>Signature Complete!</h1>
        <p style={{color:'#374151',marginBottom:8}}>Thank you, <strong>{signerName}</strong>!</p>
        <p style={{color:'#6b7280',fontSize:14}}>Your signature has been recorded. A confirmation has been emailed to you.</p>
        <p style={{color:'#9ca3af',fontSize:12,marginTop:16}}>Signed: {new Date(signedAt).toLocaleString()}</p>
      </div>
    </div>
  )

  return (
    <div style={{background:'#f8fafc',minHeight:'100vh',paddingBottom:48,fontFamily:'Arial,sans-serif'}}>
      <div style={{background:'#111827',color:'white',padding:'20px 16px',textAlign:'center'}}>
        <h1 style={{margin:0,fontSize:20,fontWeight:700}}>Alpha International Auto Center</h1>
        <p style={{margin:'4px 0 0',fontSize:13,opacity:0.7}}>Electronic Signature Request</p>
      </div>

      <div style={{maxWidth:640,margin:'0 auto',padding:16}}>
        <div style={{background:'white',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.07)',padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <p style={{margin:0,fontSize:11,color:'#9ca3af',textTransform:'uppercase',letterSpacing:1}}>{doc?.type}</p>
              <h2 style={{margin:'4px 0 0',fontSize:26,fontWeight:700,color:'#111827'}}>#{doc?.doc_number}</h2>
              {vehicle && <p style={{margin:'6px 0 0',color:'#4b5563'}}>🚗 {vehicle}</p>}
            </div>
            <div style={{textAlign:'right'}}>
              <p style={{margin:0,fontSize:11,color:'#9ca3af'}}>Total</p>
              <p style={{margin:'4px 0 0',fontSize:28,fontWeight:700,color:'#111827'}}>${total.toFixed(2)}</p>
              <p style={{margin:'4px 0 0',fontSize:12,color:'#9ca3af'}}>{doc?.doc_date}</p>
            </div>
          </div>
          <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #f3f4f6'}}>
            <p style={{margin:0,fontSize:14,color:'#4b5563'}}>Customer: <strong>{doc?.customer_name}</strong></p>
          </div>
        </div>

        {lineItems.length > 0 && (
          <div style={{background:'white',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.07)',padding:20,marginBottom:16}}>
            <h3 style={{margin:'0 0 12px',fontSize:15,fontWeight:600,color:'#111827'}}>Services &amp; Parts</h3>
            {lineItems.map((item, i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:i<lineItems.length-1?'1px solid #f9fafb':'none'}}>
                <div style={{flex:1,paddingRight:16}}>
                  <p style={{margin:0,fontSize:14,color:'#111827'}}>{item.description}</p>
                  {item.qty && item.qty > 1 && <p style={{margin:'2px 0 0',fontSize:12,color:'#9ca3af'}}>Qty: {item.qty}</p>}
                </div>
                <p style={{margin:0,fontSize:14,fontWeight:600,color:'#111827',whiteSpace:'nowrap'}}>
                  ${(item.total || (Number(item.qty||1)*Number(item.unitPrice||item.unit_price||0))).toFixed(2)}
                </p>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',marginTop:12,paddingTop:12,borderTop:'2px solid #e5e7eb',fontWeight:700,fontSize:16}}>
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {doc?.notes && (
          <div style={{background:'white',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.07)',padding:20,marginBottom:16}}>
            <h3 style={{margin:'0 0 8px',fontSize:15,fontWeight:600}}>Notes</h3>
            <p style={{margin:0,fontSize:14,color:'#4b5563',whiteSpace:'pre-wrap'}}>{doc.notes}</p>
          </div>
        )}

        {doc?.warranty_type && doc.warranty_type !== 'No Warranty' && (
          <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:16,padding:20,marginBottom:16}}>
            <h3 style={{margin:'0 0 8px',fontSize:15,fontWeight:600,color:'#1e40af'}}>🛡️ Warranty: {doc.warranty_type}</h3>
            {(doc.warranty_months || doc.warranty_mileage) && (
              <p style={{margin:'0 0 8px',fontSize:13,color:'#1d4ed8'}}>
                {doc.warranty_months ? doc.warranty_months + ' months' : ''}
                {doc.warranty_months && doc.warranty_mileage ? ' / ' : ''}
                {doc.warranty_mileage ? doc.warranty_mileage.toLocaleString() + ' miles' : ''}
                {doc.warranty_start ? ' from ' + doc.warranty_start : ''}
              </p>
            )}
            {doc.warranty_exclusions && (
              <details>
                <summary style={{fontSize:12,color:'#1d4ed8',cursor:'pointer',fontWeight:600}}>View Full Warranty Terms</summary>
                <p style={{margin:'8px 0 0',fontSize:11,color:'#1e40af',whiteSpace:'pre-wrap',lineHeight:1.6}}>{doc.warranty_exclusions}</p>
              </details>
            )}
          </div>
        )}

        <div style={{background:'white',borderRadius:16,boxShadow:'0 2px 12px rgba(0,0,0,.07)',padding:20,marginBottom:16}}>
          <h3 style={{margin:'0 0 16px',fontSize:16,fontWeight:700,color:'#111827'}}>✍️ Sign Below</h3>

          <div style={{marginBottom:16}}>
            <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:6}}>Full Legal Name</label>
            <input
              type="text"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="Type your full name"
              style={{width:'100%',border:'1.5px solid #d1d5db',borderRadius:10,padding:'12px 14px',fontSize:15,color:'#111827',boxSizing:'border-box',outline:'none'}}
            />
          </div>

          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <label style={{fontSize:13,fontWeight:600,color:'#374151'}}>Draw Your Signature</label>
              <button onClick={clearSig} style={{background:'none',border:'none',color:'#ef4444',fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}>Clear</button>
            </div>
            <div style={{border:'2px dashed #d1d5db',borderRadius:12,background:'#f9fafb',position:'relative',overflow:'hidden'}}>
              <canvas
                ref={canvasRef}
                width={600}
                height={180}
                style={{width:'100%',display:'block',cursor:'crosshair',touchAction:'none'}}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              {!hasSignature && (
                <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
                  <p style={{color:'#9ca3af',fontSize:14,margin:0}}>Sign here with mouse or finger</p>
                </div>
              )}
            </div>
          </div>

          <div style={{marginBottom:20}}>
            <label style={{display:'flex',alignItems:'flex-start',gap:12,cursor:'pointer'}}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{width:18,height:18,marginTop:2,accentColor:'#2563eb',flexShrink:0}} />
              <span style={{fontSize:13,color:'#374151',lineHeight:1.6}}>
                I, <strong>{signerName || '[Your Name]'}</strong>, agree that this electronic signature is the legal equivalent of my handwritten signature. I accept the services, charges, and warranty terms on this {doc?.type}.
              </span>
            </label>
          </div>

          <button
            onClick={handleSubmit}
            disabled={state === 'signing'}
            style={{width:'100%',background:'#2563eb',color:'white',border:'none',borderRadius:12,padding:16,fontSize:17,fontWeight:700,cursor:state==='signing'?'not-allowed':'pointer',opacity:state==='signing'?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}
          >
            {state === 'signing' ? (
              <><span style={{width:20,height:20,border:'2px solid white',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'spin 0.8s linear infinite'}} /> Saving…</>
            ) : '✅ Sign & Submit'}
          </button>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          <p style={{textAlign:'center',fontSize:12,color:'#9ca3af',marginTop:10}}>
            Your signed confirmation will be emailed to you immediately.
          </p>
        </div>

        <p style={{textAlign:'center',fontSize:11,color:'#9ca3af'}}>
          Alpha International Auto Center · Houston, TX · Official Electronic Document
        </p>
      </div>
    </div>
  )
}
