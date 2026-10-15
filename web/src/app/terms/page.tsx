import { PublicPage } from '@/components/PublicChrome'

export const metadata = {
  title: 'Terms',
  description: 'Terms overview for Alpha Desk.',
}

export default function TermsPage() {
  return (
    <PublicPage current="terms">
      <h1 className="page-title">Terms overview</h1>
      <div className="mt-8 max-w-[60ch] space-y-5 leading-7 text-text-secondary">
        <p>Use Alpha Desk only for shop operations you are authorized to perform. You are responsible for the accuracy of customer records, estimates, payment entries, messages, and connected-provider settings.</p>
        <p>AI output is assistance for shop staff. Review estimates, repair information, customer communications, and external actions before approving or sending them.</p>
        <p>External providers may be unavailable or may apply their own limits and terms. This overview does not replace the agreement governing your shop’s use of the service.</p>
      </div>
    </PublicPage>
  )
}
