import { PublicPage } from '@/components/PublicChrome'

export const metadata = {
  title: 'Privacy',
  description: 'Privacy and security overview for Alpha Desk.',
}

export default function PrivacyPage() {
  return (
    <PublicPage current="privacy">
      <h1 className="page-title">Privacy overview</h1>
      <p className="mt-3 max-w-[60ch] text-[1.0625rem] leading-7 text-text-secondary">Alpha Desk stores shop data needed to operate the workspace, including customer, vehicle, job, document, payment, appointment, and message records.</p>
      <div className="mt-8 max-w-[60ch] space-y-5 leading-7 text-text-secondary">
        <p>Access is restricted to the authenticated shop account and server-side integrations. Provider credentials are not exposed to browser clients, and shop records are scoped by shop.</p>
        <p>When you connect an outside service, that service may process information according to its own terms. Do not enter information that your shop is not authorized to store or send.</p>
        <p>This page is an operational overview, not a substitute for a signed privacy policy or legal advice. Ask your account administrator for the policy that applies to your shop.</p>
      </div>
    </PublicPage>
  )
}
