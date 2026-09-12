export const metadata = {
  title: 'Terms | Alpha AI Desk',
  description: 'Terms overview for Alpha AI Desk.',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-bg-base px-6 py-16 text-text-primary">
      <div className="mx-auto max-w-2xl">
        <a href="/login" className="text-sm font-bold text-blue hover:underline">← Back to sign in</a>
        <p className="mt-10 text-xs font-black uppercase tracking-[0.18em] text-blue">Alpha AI Desk</p>
        <h1 className="mt-3 text-4xl font-black">Terms overview</h1>
        <div className="mt-8 space-y-4 text-sm leading-6 text-text-secondary">
          <p>Use Alpha AI Desk only for shop operations you are authorized to perform. You are responsible for the accuracy of customer records, estimates, payment entries, messages, and connected-provider settings.</p>
          <p>AI output is assistance for shop staff. Review estimates, repair information, customer communications, and external actions before approving or sending them.</p>
          <p>External providers may be unavailable or may apply their own limits and terms. This overview does not replace the agreement governing your shop’s use of the service.</p>
        </div>
      </div>
    </main>
  )
}
