'use client'
import { useState } from 'react'

const DEMO_VOICEMAILS = [
  {
    id: '1',
    caller: '(281) 555-1234',
    timestamp: 'Today, 9:14 AM',
    transcript: 'Hi, I need an oil change for my 2019 Toyota Camry, can I get a quote?',
    read: false,
  },
  {
    id: '2',
    caller: '(713) 555-8821',
    timestamp: 'Today, 8:02 AM',
    transcript: 'My check engine light came on and the car is making a grinding noise when I brake. How soon can you take a look?',
    read: false,
  },
  {
    id: '3',
    caller: '(832) 555-4490',
    timestamp: 'Yesterday, 5:47 PM',
    transcript: 'Hi this is Marcus, just calling to check on my truck — the F-150. Was supposed to be ready today.',
    read: true,
  },
]

export default function VoicemailPage() {
  const [voicemails, setVoicemails] = useState(DEMO_VOICEMAILS)

  const markRead = (id: string) => {
    setVoicemails(v => v.map(vm => vm.id === id ? { ...vm, read: true } : vm))
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-amber">AI Voicemail</h1>
        <p className="text-text-muted text-sm mt-1">Never miss a customer call</p>
      </div>

      {/* Setup Card */}
      <div className="card border-amber/20 bg-amber/5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-amber mb-4">Setup</h2>
        <div className="space-y-5">

          {/* Step 1 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-amber/20 flex items-center justify-center text-amber font-bold text-sm shrink-0">1</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Call your carrier to enable conditional call forwarding</p>
              <div className="mt-2 bg-bg-hover border border-border rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Universal code (call-forward-no-answer):</p>
                <code className="text-amber font-mono text-sm">**61*[forwarding_number]#</code>
              </div>
              <p className="text-xs text-text-muted mt-2">Most carriers support this. For AT&T/T-Mobile dial <code className="text-amber">**61*[number]#</code> and press Call.</p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-amber/20 flex items-center justify-center text-amber font-bold text-sm shrink-0">2</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Get your AI forwarding number</p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="bg-green/10 text-green text-xs font-bold px-2.5 py-1 rounded-full border border-green/30">Coming Soon</span>
                <span className="text-sm text-text-muted">Your dedicated AI line will appear here</span>
              </div>
              <p className="text-xs text-text-muted mt-2">When your AI line is active, customers who aren&apos;t answered within 4 rings will be greeted by your AI assistant.</p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-amber/20 flex items-center justify-center text-amber font-bold text-sm shrink-0">3</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Test it</p>
              <p className="text-sm text-text-muted mt-1">Call your shop number from another phone and don&apos;t answer. The AI will pick up and take a message.</p>
            </div>
          </div>

        </div>
      </div>

      {/* Voicemail Inbox */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">Voicemail Inbox</h2>
        <div className="space-y-3">
          {voicemails.map(vm => (
            <div key={vm.id} className={`card border ${vm.read ? 'border-border' : 'border-amber/30 bg-amber/5'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{vm.caller}</span>
                    {!vm.read && <span className="w-2 h-2 rounded-full bg-amber shrink-0" />}
                  </div>
                  <p className="text-xs text-text-muted mb-2">{vm.timestamp}</p>
                  <div className="bg-bg-hover border border-border rounded-lg p-3">
                    <p className="text-xs text-text-muted mb-1">AI Transcript</p>
                    <p className="text-sm">&ldquo;{vm.transcript}&rdquo;</p>
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm shrink-0"
                  onClick={() => markRead(vm.id)}
                  disabled={vm.read}
                >
                  {vm.read ? '✓ Read' : 'Mark Read'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="card border-border bg-bg-hover/50">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">How it works</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>Customer calls</span>
          <span className="text-amber font-bold">→</span>
          <span>No answer (4 rings)</span>
          <span className="text-amber font-bold">→</span>
          <span>Forwards to AI</span>
          <span className="text-amber font-bold">→</span>
          <span>AI greets with shop name</span>
          <span className="text-amber font-bold">→</span>
          <span>Takes message</span>
          <span className="text-amber font-bold">→</span>
          <span className="text-amber font-semibold">Transcript appears in dashboard</span>
        </div>
      </div>
    </div>
  )
}
