'use client'
import Icon from '@/components/Icon'
import { accountLabel, type Connector, type ServiceInfo } from './services'

export default function ServiceCard({
  info, connector, busy, connecting, anyBusy, onConnect, onDisconnect,
}: {
  info: ServiceInfo
  connector: Connector | undefined
  /** This card is being disconnected. */
  busy: boolean
  /** This card sent the person off to sign in. */
  connecting: boolean
  /** Some other card is mid-action, so the sign-in buttons wait. */
  anyBusy: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const isConnected = connector?.enabled === true
  const account = connector ? accountLabel(connector) : { name: null, id: null }

  return (
    <li className="card flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name={info.icon} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="section-title">{info.name}</h2>
          <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{info.description}</p>
        </div>
      </div>

      {isConnected && (account.name || account.id) && (
        <p className="break-words rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]">
          {account.name ? (
            <><span className="text-text-secondary">Signed in as </span><span className="font-bold">{account.name}</span></>
          ) : (
            <><span className="text-text-secondary">Account ID </span><span className="num font-bold">{account.id}</span></>
          )}
        </p>
      )}

      {!isConnected && <p className="text-[0.9375rem] text-text-secondary">{info.note}</p>}

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 font-bold" aria-live="polite">
          <span className={`lamp ${isConnected ? 'lamp-green' : connecting ? 'lamp-blue' : 'lamp-off'}`} aria-hidden="true" />
          {isConnected ? 'Connected' : connecting ? 'Opening sign-in…' : 'Not connected'}
        </p>
        {isConnected ? (
          <button
            type="button"
            className="btn btn-danger w-full sm:w-auto"
            onClick={onDisconnect}
            disabled={busy || anyBusy}
            aria-label={`Disconnect ${info.name}`}
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={onConnect} disabled={connecting || anyBusy}>
            <Icon name="link" className="h-5 w-5" />
            Connect {info.short}
          </button>
        )}
      </div>
    </li>
  )
}
