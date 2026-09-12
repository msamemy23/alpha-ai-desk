export const metadata = {
  title: 'Help | Alpha AI Desk',
  description: 'Get help using Alpha AI Desk.',
}

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-bg-base px-6 py-16 text-text-primary">
      <div className="mx-auto max-w-2xl">
        <a href="/login" className="text-sm font-bold text-blue hover:underline">← Back to sign in</a>
        <p className="mt-10 text-xs font-black uppercase tracking-[0.18em] text-blue">Alpha AI Desk</p>
        <h1 className="mt-3 text-4xl font-black">Help</h1>
        <p className="mt-4 text-text-secondary">Alpha AI Desk keeps customer history, estimates, payments, appointments, messages, and shop workflows in one workspace.</p>
        <section className="mt-8 rounded-xl border border-border bg-bg-card p-5">
          <h2 className="font-bold">Having trouble signing in?</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">Use the password reset link on the sign-in screen, or choose Google if your account was created with Google. For shop-specific access, contact the person who manages your shop account.</p>
        </section>
        <section className="mt-4 rounded-xl border border-border bg-bg-card p-5">
          <h2 className="font-bold">Need help inside the app?</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">Open Alpha AI from the navigation and ask about a workflow. External actions such as sending messages, making calls, or changing automation settings require confirmation.</p>
        </section>
      </div>
    </main>
  )
}
