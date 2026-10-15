'use client'
import { useId, useRef, useState } from 'react'
import Notice from '@/components/Notice'
import { Segmented } from '@/components/ScreenParts'
import { HOLD_HOURS, MAX_CAP, MIN_CAP, MODE_WORDS, PLATFORM_LABEL, POST_MODES, capWords } from '@/lib/posts-rules'
import type { PostMode, PostPlatform } from '@/lib/posts-rules'
import type { PostActionOk, PostOverview } from '@/lib/posts-api-types'
import PlacesPicker from './PlacesPicker'
import type { Done } from './postsApi'

export interface SettingsPatch { mode?: PostMode; weekly_cap?: number; platforms?: PostPlatform[]; confirm_auto?: boolean }

interface Props {
  overview: PostOverview
  onChange: (patch: SettingsPatch) => Promise<Done<PostActionOk>>
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const CAPS = Array.from({ length: MAX_CAP - MIN_CAP + 1 }, (_, i) => MIN_CAP + i)

/** The Off, Suggest, Auto choice, the weekly limit and the places posts may go. Off until the owner changes it. */
export default function PostAutoCard({ overview, onChange, notify }: Props) {
  const base = useId()
  const { settings, connections } = overview
  const editable = overview.can_edit && overview.available
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const busy = useRef(false)
  const words = MODE_WORDS[settings.mode]

  const save = async (patch: SettingsPatch) => {
    if (busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const r = await onChange(patch)
      if (r.ok) { setAsking(false); notify(r.data.message || 'Saved.', 'success') }
      else if (r.code === 'confirm_auto') setAsking(true)
      else setError(r.error)
    } finally { busy.current = false; setSaving(false) }
  }

  const choose = (mode: PostMode) => {
    if (mode === settings.mode) return
    setError('')
    if (mode === 'auto') {
      if (settings.platforms.length === 0) { setError('Choose where posts go first, then turn on Auto.'); return }
      // From Suggest, Auto needs a clear yes. From Off the server starts it in Suggest, so a first-time owner always sees a few posts first.
      if (settings.mode === 'suggest') { setAsking(true); return }
    }
    setAsking(false)
    void save({ mode })
  }

  const places = settings.platforms.map(p => PLATFORM_LABEL[p])
  const showRules = settings.mode === 'auto' || asking

  return (
    <section className="card space-y-4" aria-label="Automatic posting">
      <div>
        <h3 className="section-title">Automatic posting</h3>
        <p className="mt-0.5 flex items-center gap-2 font-bold"><span className={`lamp lamp-${words.lamp}`} aria-hidden="true" />{words.word === 'Off' ? 'Off. Alpha does not post by itself.' : words.word === 'Suggest' ? 'Suggest. Alpha prepares posts and waits for your OK.' : 'Auto. Alpha posts on its own within your rules.'}</p>
      </div>

      {overview.notes.map(n => <Notice key={n} kind="info">{n}</Notice>)}

      {!overview.can_edit && <Notice kind="info">Only the owner, an admin or a manager can change these settings.</Notice>}

      <div>
        <p className="form-label">Mode</p>
        <div className="max-w-md">
          <Segmented
            label="Automatic posting mode"
            idPrefix={`${base}-mode`}
            columns="grid-cols-3"
            options={POST_MODES.map(m => ({ key: m, label: MODE_WORDS[m].word }))}
            value={settings.mode}
            onChange={m => { if (editable && !saving) choose(m) }}
          />
        </div>
        <p id={`${base}-mode-panel`} role="tabpanel" aria-labelledby={`${base}-mode-tab-${settings.mode}`} className="form-hint">{words.help}</p>
      </div>

      {asking && (
        <div className="rounded-md border border-border bg-bg-hover p-3" role="alertdialog" aria-label="Confirm turning on Auto">
          <p className="font-bold">Turn on Auto?</p>
          <p className="mt-1 text-text-secondary">
            Alpha will post on its own to {places.length ? places.join(' and ') : 'the apps you chose'}, for finished jobs where the customer said yes, using only photos you already checked, and never more than {settings.weeklyCap} {settings.weeklyCap === 1 ? 'post' : 'posts'} a week. You can turn it off at any time. A post that has gone out cannot be undone from Alpha.
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)} disabled={saving}>Keep it on {MODE_WORDS[settings.mode].word}</button>
            <button type="button" className="btn btn-primary" onClick={() => void save({ mode: 'auto', confirm_auto: true })} disabled={saving} aria-busy={saving}>{saving ? 'Turning on…' : 'Yes, turn on Auto'}</button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${base}-cap`} className="form-label">Most posts in a week</label>
          <select id={`${base}-cap`} className="form-select" value={settings.weeklyCap} disabled={!editable || saving} onChange={e => void save({ weekly_cap: Number(e.target.value) })}>
            {CAPS.map(n => <option key={n} value={n}>{n} {n === 1 ? 'post' : 'posts'}</option>)}
          </select>
          <p className="form-hint">{capWords(overview.used_this_week, settings.weeklyCap)} The limit counts every post, including ones you send yourself.</p>
        </div>
        <PlacesPicker value={settings.platforms} connections={connections} disabled={!editable || saving} onChange={next => void save({ platforms: next })} />
      </div>

      {showRules && (
        <div>
          <p className="font-bold">Auto posts only when all of this is true</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-secondary">
            <li>The job is finished and the customer said yes to a post about it.</li>
            <li>You already checked every photo for plates, VINs and anything private.</li>
            <li>The words passed Alpha’s checks and say only what the job record says.</li>
            <li>An app you chose is connected. Anything not connected is skipped and logged.</li>
            <li>The weekly limit has room.</li>
            <li>The post waited {HOLD_HOURS} hours in your queue so you could look first.</li>
          </ul>
          <p className="form-hint">Posts you make yourself always wait for your tap. Alpha looks for posts to send once a day, so an Auto post can go out up to a day after its review window ends.</p>
        </div>
      )}

      {error && <Notice kind="error">{error}</Notice>}
    </section>
  )
}
