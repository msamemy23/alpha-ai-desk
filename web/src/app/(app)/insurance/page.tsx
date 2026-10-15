'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField } from '@/components/ListKit'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import AddClaimSheet from '@/components/insurance/AddClaimSheet'
import ClaimAssistant from '@/components/insurance/ClaimAssistant'
import ClaimDetail from '@/components/insurance/ClaimDetail'
import { carOf, lampOf, money, statusLabel } from '@/components/insurance/types'
import type { Job, NoteEntry } from '@/components/insurance/types'
import { claimApprovedTotal, claimIsOpen, hasSupplement, openForLabel, owesDeductible, reasonOf, roLabel, supplementWaiting } from '@/lib/list-logic'

type FilterKey = 'all' | 'open' | 'supplement' | 'deductible' | 'paid'

const NO_SHOP = 'We could not find your shop. Try refreshing, or sign out and back in.'

function Lampword({ status }: { status: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold">
      <span className={`lamp lamp-${lampOf(status)}`} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

export default function InsurancePage() {
  return (
    <Suspense fallback={<div className="page-container"><header className="page-header"><div><h1 className="page-title">Insurance claims</h1></div></header><RowsSkeleton rows={4} label="Loading claims" /></div>}>
      <Claims />
    </Suspense>
  )
}

function Claims() {
  const router = useRouter()
  const params = useSearchParams()
  const claimId = params.get('claim')

  const [jobs, setJobs] = useState<Job[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [flash, setFlash] = useState<Flash | null>(null)
  const [adding, setAdding] = useState(false)
  const [askId, setAskId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setJobs([]); setLoadError(NO_SHOP); return }
      const { data, error } = await supabase.from('jobs').select('*').eq('shop_id', shopId).eq('is_insurance', true).order('created_at', { ascending: false }).limit(1000)
      if (error) throw error
      setJobs((data || []) as Job[])
      setLoadError('')
    } catch {
      setLoadError('Your insurance claims could not be loaded. Check your connection and try again.')
    } finally { setLoaded(true) }
  }, [])

  useEffect(() => {
    void load()
    const ch = supabase.channel('ins_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => { void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  useEffect(() => {
    if (!flash || flash.kind === 'error') return
    const t = setTimeout(() => setFlash(null), flash.action ? 15000 : 7000)
    return () => clearTimeout(t)
  }, [flash])

  // Opening or leaving a claim starts at the top of the page, not wherever the list was scrolled.
  useEffect(() => { document.getElementById('main')?.scrollTo(0, 0) }, [claimId])

  const claim = claimId ? jobs.find(j => j.id === claimId) || null : null

  /* ---------- saving ---------- */
  const patchLocal = useCallback((id: string, patch: Record<string, unknown>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  const saveClaim = useCallback(async (id: string, patch: Record<string, unknown>): Promise<string | null> => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const stamped = { ...patch, updated_at: new Date().toISOString() }
      const { error } = await supabase.from('jobs').update(stamped).eq('id', id).eq('shop_id', shopId)
      if (error) throw new Error(error.message)
      patchLocal(id, stamped)
      return null
    } catch (e) {
      return `Not saved. ${reasonOf(e, 'Check your connection.')}`
    }
  }, [patchLocal])

  /** Reads the log fresh before changing it, so a note added on another screen is not overwritten. */
  const changeLog = useCallback(async (id: string, change: (log: NoteEntry[]) => NoteEntry[]): Promise<string | null> => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const fresh = await supabase.from('jobs').select('communication_log').eq('id', id).eq('shop_id', shopId).maybeSingle()
      if (fresh.error) throw new Error(fresh.error.message)
      const current = Array.isArray(fresh.data?.communication_log) ? (fresh.data.communication_log as NoteEntry[]) : []
      const next = change(current)
      const stamped = { communication_log: next, updated_at: new Date().toISOString() }
      const { error } = await supabase.from('jobs').update(stamped).eq('id', id).eq('shop_id', shopId)
      if (error) throw new Error(error.message)
      patchLocal(id, stamped)
      return null
    } catch (e) {
      return `The note was not saved. ${reasonOf(e, 'Check your connection.')}`
    }
  }, [patchLocal])

  const openClaim = (id: string) => router.push(`/insurance?claim=${encodeURIComponent(id)}`, { scroll: false })
  const closeClaim = () => router.push('/insurance', { scroll: false })

  const addClaim = async (job: Job): Promise<string | null> => {
    const problem = await saveClaim(job.id, { is_insurance: true })
    if (problem) return `This repair order was not added. ${problem.replace(/^Not saved\. /, '')}`
    await load()
    setAdding(false)
    setFlash({ kind: 'success', text: `${job.customer_name || 'The repair order'} was added as a claim. Fill in the insurance details below.` })
    openClaim(job.id)
    return null
  }

  const removeClaim = async () => {
    if (!claim || removeBusy) return
    setRemoveBusy(true); setRemoveError('')
    const target = claim
    const problem = await saveClaim(target.id, { is_insurance: false })
    setRemoveBusy(false)
    if (problem) { setRemoveError(`This claim was not removed. ${problem.replace(/^Not saved\. /, '')}`); return }
    setRemoving(false)
    setFlash({
      kind: 'success', text: `${target.customer_name || 'The claim'} was taken off your claims. The repair order is untouched.`,
      action: { label: 'Undo', run: () => { void (async () => { const p = await saveClaim(target.id, { is_insurance: true }); if (p) setFlash({ kind: 'error', text: `The claim could not be put back. ${p.replace(/^Not saved\. /, '')}` }); else { await load(); setFlash({ kind: 'success', text: 'The claim is back.' }) } })() } },
    })
    await load()
    closeClaim()
  }

  /* ---------- the list ---------- */
  const words = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search])
  const filtered = useMemo(() => jobs.filter(j => {
    if (words.length) {
      const hay = [j.customer_name, j.insurance_company, j.claim_number, j.adjuster, j.policy_number, j.ro_number, carOf(j)].join(' ').toLowerCase()
      if (!words.every(w => hay.includes(w))) return false
    }
    if (filter === 'open') return claimIsOpen(j)
    if (filter === 'supplement') return hasSupplement(j)
    if (filter === 'deductible') return owesDeductible(j)
    if (filter === 'paid') return !claimIsOpen(j)
    return true
  }).sort((a, b) => (claimIsOpen(b) ? 1 : 0) - (claimIsOpen(a) ? 1 : 0)), [jobs, filter, words])

  const counts = useMemo(() => ({
    all: jobs.length,
    open: jobs.filter(claimIsOpen).length,
    supplement: jobs.filter(hasSupplement).length,
    deductible: jobs.filter(owesDeductible).length,
    paid: jobs.filter(j => !claimIsOpen(j)).length,
  }), [jobs])

  const openJobs = jobs.filter(claimIsOpen)
  const totalApproved = openJobs.reduce((s, j) => s + claimApprovedTotal(j), 0)
  const totalDeductibleDue = openJobs.filter(owesDeductible).reduce((s, j) => s + (Number(j.deductible) || 0), 0)
  const supplementPending = openJobs.filter(supplementWaiting).length

  const askJob = askId ? jobs.find(j => j.id === askId) || null : null
  const assistant = <ClaimAssistant key={askJob?.id || 'none'} job={askJob} onClose={() => setAskId(null)} />

  /* ---------- one claim ---------- */
  if (claimId) {
    if (!loaded) return <div className="page-container"><RowsSkeleton rows={4} label="Loading claim" /></div>
    if (!claim) {
      return (
        <div className="page-container animate-fade-in">
          <button type="button" className="btn btn-ghost -ml-3 mb-1" onClick={closeClaim}><Icon name="back" className="h-5 w-5" />All claims</button>
          {loadError
            ? <ErrorCard title="Claims could not load" message={loadError} onRetry={() => void load()} />
            : <EmptyBlock icon="shield" title="This claim was not found" action={<button type="button" className="btn btn-primary" onClick={closeClaim}>Back to all claims</button>}>It may have been removed from claims, or the link is old.</EmptyBlock>}
        </div>
      )
    }
    return (
      <>
        {flash && <div className="page-container !pb-0"><FlashNotice flash={flash} onDismiss={() => setFlash(null)} className="mb-0" /></div>}
        <ClaimDetail
          job={claim}
          save={patch => saveClaim(claim.id, patch)}
          onBack={closeClaim}
          onAsk={() => setAskId(claim.id)}
          onAddNote={(type, text) => changeLog(claim.id, log => [{ id: crypto.randomUUID(), date: new Date().toISOString(), type, text }, ...log])}
          onDeleteNote={id => changeLog(claim.id, log => log.filter(n => n.id !== id))}
          onRemove={() => { setRemoveError(''); setRemoving(true) }}
        />
        <ConfirmSheet
          open={removing}
          title="Take this off your claims?"
          confirmLabel="Remove from claims"
          busyLabel="Removing…"
          cancelLabel="Keep it as a claim"
          busy={removeBusy}
          error={removeError}
          onConfirm={() => void removeClaim()}
          onCancel={() => { if (!removeBusy) setRemoving(false) }}
        >
          <p>{claim.customer_name || 'This'} stays on your jobs as a normal repair order. The insurance details, amounts and notes you entered stay on it too, and come back if you add it as a claim again.</p>
        </ConfirmSheet>
        {assistant}
      </>
    )
  }

  /* ---------- the claims list ---------- */
  const filtering = filter !== 'all' || words.length > 0
  const firstLoad = !loaded && !loadError
  const clearFilters = () => { setFilter('all'); setSearch('') }
  const label = 'text-[0.875rem] text-text-secondary'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Insurance claims</h1>
          <p className="page-subtitle">Claims, adjusters, deductibles and supplements in one place.</p>
        </div>
        {!(loaded && !loadError && jobs.length === 0) && (
          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setAdding(true)} disabled={firstLoad}><Icon name="plus" className="h-5 w-5" />Add a claim</button>
        )}
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Claims could not load" message={jobs.length > 0 ? `${loadError} What you see may be out of date.` : loadError} onRetry={() => void load()} />}
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

      {loaded && jobs.length > 0 && (
        <>
          <dl className="panel mb-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4" aria-label="Claims summary">
            <div className="flex flex-col justify-center border-b border-r border-border px-4 py-3 sm:border-b-0">
              <dt className="text-[0.875rem] font-bold text-text-secondary">Open claims</dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{openJobs.length}</dd>
            </div>
            <div className="flex flex-col justify-center border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
              <dt className="text-[0.875rem] font-bold text-text-secondary">Approved, with supplements</dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{money(totalApproved)}</dd>
            </div>
            <div className={`flex flex-col justify-center border-r border-border px-4 py-3 ${totalDeductibleDue > 0 ? 'bg-amber/[0.14]' : ''}`}>
              <dt className={`flex items-center gap-2 text-[0.875rem] font-bold ${totalDeductibleDue > 0 ? 'text-amber' : 'text-text-secondary'}`}>
                <span className={`lamp ${totalDeductibleDue > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Deductibles to collect
              </dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{money(totalDeductibleDue)}</dd>
            </div>
            <div className="flex flex-col justify-center px-4 py-3">
              <dt className="flex items-center gap-2 text-[0.875rem] font-bold text-text-secondary">
                <span className={`lamp ${supplementPending > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Supplements pending
              </dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{supplementPending}</dd>
            </div>
          </dl>

          <div className="mb-4 space-y-3">
            <SearchField className="sm:max-w-md" label="Search claims by customer, insurer, claim number, adjuster or car" placeholder="Search claims" value={search} onChange={setSearch} />
            <FilterChips<FilterKey> scroll label="Show claims" value={filter} onChange={setFilter} options={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'open', label: 'Open', count: counts.open },
              { key: 'supplement', label: 'Supplement', count: counts.supplement },
              { key: 'deductible', label: 'Deductible due', count: counts.deductible },
              { key: 'paid', label: 'Paid or closed', count: counts.paid },
            ]} />
          </div>
        </>
      )}

      {firstLoad ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading claims" role="status">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-52" />)}
        </div>
      ) : loadError && jobs.length === 0 ? null : jobs.length === 0 ? (
        <EmptyBlock icon="shield" title="No insurance claims yet" action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-5 w-5" />Add a claim</button>}>
          Pick a repair order that is going through insurance and it shows up here, with its adjuster, claim number, deductible and supplements.
        </EmptyBlock>
      ) : filtered.length === 0 ? (
        <EmptyBlock icon="search" title={words.length ? `No claims match “${search.trim()}”` : 'No claims match'} action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Show all claims</button>}>
          {words.length ? 'Try a customer name, the insurer or the claim number.' : filter === 'deductible' ? 'No deductible is waiting to be collected.' : filter === 'supplement' ? 'No claim has a supplement right now.' : 'No claim fits this filter.'}
        </EmptyBlock>
      ) : (
        <>
          {filtering && (
            <p className="mb-2 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
              <span><span className="num font-bold text-text-primary">{filtered.length}</span> {filtered.length === 1 ? 'claim' : 'claims'} shown</span>
              <button type="button" className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline" onClick={clearFilters}>Show all</button>
            </p>
          )}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(j => (
              <li key={j.id} className={`rotag lamp-${lampOf(j.status)} !flex flex-col`}>
                <button type="button" className="block w-full text-left" onClick={() => openClaim(j.id)} aria-label={`Open claim for ${j.customer_name || 'unknown customer'}`}>
                  <span className="block min-w-0">
                    <span className="display block text-[1.125rem] font-bold leading-tight">{j.customer_name || 'Unknown customer'}</span>
                    <span className="block text-text-secondary">{carOf(j) || 'No vehicle'}{j.ro_number ? ` · ${roLabel(j.ro_number)}` : ''}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <Lampword status={j.status} />
                      {claimIsOpen(j) && openForLabel(j.created_at) && <span className="num text-[0.9375rem] text-text-secondary">{openForLabel(j.created_at)}</span>}
                    </span>
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    {[
                      { label: 'Insurance', value: j.insurance_company, none: 'Not entered' },
                      { label: 'Claim number', value: j.claim_number, none: 'Not entered' },
                      { label: 'Adjuster', value: j.adjuster, none: 'Not entered' },
                      { label: 'Supplement', value: hasSupplement(j) ? j.supplement_status : 'None', none: 'None' },
                    ].map(f => (
                      <span key={f.label} className="block min-w-0">
                        <span className={`block ${label}`}>{f.label}</span>
                        <span className={`block break-words ${f.value ? 'font-bold' : 'text-text-secondary'}`}>{f.value || f.none}</span>
                      </span>
                    ))}
                    <span className="block">
                      <span className={`block ${label}`}>Approved</span>
                      <span className={`num block ${claimApprovedTotal(j) ? 'font-bold' : 'text-text-secondary'}`}>{claimApprovedTotal(j) ? money(claimApprovedTotal(j)) : 'Not entered'}</span>
                    </span>
                    <span className="block">
                      <span className={`block ${label}`}>Deductible</span>
                      <span className={`num block ${j.deductible ? 'font-bold' : 'text-text-secondary'}`}>{j.deductible ? money(j.deductible) : 'None'}</span>
                    </span>
                  </span>
                  {owesDeductible(j) && (
                    <span className="mt-3 flex items-center gap-2 border-t border-border pt-2 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Deductible not collected</span>
                  )}
                  {j.inspection_notes && (
                    <span className="mt-2 line-clamp-2 block text-[0.9375rem] text-text-secondary">{j.inspection_notes}</span>
                  )}
                </button>
                <div className="mt-auto flex gap-2 pt-3">
                  <button type="button" className="btn btn-secondary flex-1 whitespace-nowrap px-3" onClick={() => setAskId(j.id)}><Icon name="alpha" className="h-5 w-5" />Ask Alpha</button>
                  <button type="button" className="btn btn-secondary flex-1 whitespace-nowrap px-3" onClick={() => openClaim(j.id)}>Open claim</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddClaimSheet open={adding} onClose={() => setAdding(false)} onAdd={addClaim} />
      {assistant}
    </div>
  )
}
