import { PublicPage } from '@/components/PublicChrome'

export const metadata = {
  title: 'Help',
  description: 'Get help using Alpha Desk.',
}

export default function HelpPage() {
  return (
    <PublicPage current="help">
      <h1 className="page-title">Help</h1>
      <p className="mt-3 max-w-[60ch] text-[1.0625rem] leading-7 text-text-secondary">Alpha Desk keeps customer history, estimates, payments, appointments, messages, and shop workflows in one workspace.</p>
      <section className="panel mt-8 p-5 sm:p-6">
        <h2 className="section-title">Having trouble signing in?</h2>
        <p className="mt-2 max-w-[60ch] leading-7 text-text-secondary">Use the password reset link on the sign-in screen, or choose Google if your account was created with Google. For shop-specific access, contact the person who manages your shop account.</p>
      </section>
      <section className="panel mt-4 p-5 sm:p-6">
        <h2 className="section-title">Need help inside the app?</h2>
        <p className="mt-2 max-w-[60ch] leading-7 text-text-secondary">Open Ask Alpha from the navigation and ask about a workflow. External actions such as sending messages, making calls, or changing automation settings require confirmation.</p>
      </section>
    </PublicPage>
  )
}
