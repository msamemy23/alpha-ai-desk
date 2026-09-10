export const metadata = {
  title: 'Privacy | Alpha AI Desk',
  description: 'Privacy and security overview for Alpha AI Desk.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-bg-base px-6 py-16 text-text-primary">
      <div className="mx-auto max-w-2xl">
        <a href="/login" className="text-sm font-bold text-blue hover:underline">← Back to sign in</a>
        <p className="mt-10 text-xs font-black uppercase tracking-[0.18em] text-blue">Alpha AI Desk</p>
        <h1 className="mt-3 text-4xl font-black">Privacy overview</h1>
        <p className="mt-4 text-sm leading-6 text-text-secondary">Alpha AI Desk stores shop data needed to operate the workspace, including customer, vehicle, job, document, payment, appointment, and message records.</p>
        <div className="mt-8 space-y-4 text-sm leading-6 text-text-secondary">
          <p>Access is restricted to the authenticated shop account and server-side integrations. Provider credentials are not exposed to browser clients, and shop records are scoped by shop.</p>
          <p>When you connect an outside service, that service may process information according to its own terms. Do not enter information that your shop is not authorized to store or send.</p>
          <p>This page is an operational overview, not a substitute for a signed privacy policy or legal advice. Ask your account administrator for the policy that applies to your shop.</p>
        </div>
      </div>
    </main>
  )
}
