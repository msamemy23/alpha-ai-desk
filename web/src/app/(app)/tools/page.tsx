'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentDefinition, SkillDefinition, ToolDefinition } from '@/lib/ai/capabilities'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { ScreenToast, useToast } from '@/components/ScreenParts'
import { plainName } from '@/lib/connector-messages'
import AgentList, { Tag, plural } from '@/components/tools/AgentList'
import { SERVER_NAME } from '@/components/tools/copy'

interface CapabilitySnapshot {
  agents: AgentDefinition[]
  tools: ToolDefinition[]
  skills: SkillDefinition[]
  generatedAt: string
}

interface McpServerState {
  id: string
  ok?: boolean
  label?: string
  description?: string
  tools?: Array<{ name: string; description?: string; required?: string[]; arguments?: string[] }>
  error?: string
}

interface KaptureStatus {
  ok: boolean
  connectedTabs: number
  activeTab?: string
  lastError?: string
}

interface McpAuditEntry {
  timestamp?: string
  server?: string
  tool?: string
  ok?: boolean
  approved?: boolean
  approvalRequired?: boolean
  cancelled?: boolean
  error?: string
}

interface ToolsElectronApi {
  isElectron?: boolean
  mcp?: {
    tools: (server?: string) => Promise<{ ok?: boolean; servers?: McpServerState[]; error?: string }>
    resources: (server?: string) => Promise<Record<string, unknown>>
    prompts: (server?: string) => Promise<Record<string, unknown>>
    callTool: (server: string, name: string, args?: Record<string, unknown>, approved?: boolean) => Promise<{ ok?: boolean; content?: Array<{ type?: string; text?: string }>; error?: string }>
    stop: (server?: string) => Promise<{ ok?: boolean; error?: string }>
    auditLog?: (limit?: number) => Promise<{ ok?: boolean; path?: string; entries?: McpAuditEntry[]; error?: string }>
  }
  kapture?: { openSetup: () => Promise<{ ok?: boolean; error?: string; instructions?: string }> }
}

function getDesktopApi() {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: ToolsElectronApi }).electronAPI
}

/** Status as a lamp plus a word. */
function Status({ lamp, children }: { lamp: 'green' | 'amber' | 'red' | 'blue' | 'off'; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold">
      <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
      {children}
    </span>
  )
}

const READ_ONLY_MCP_TOOLS: Record<string, Set<string>> = {
  windows: new Set(['snapshot', 'screenshot', 'scrape']),
  kapture: new Set(['list_tabs', 'tab_detail', 'dom', 'elements', 'screenshot', 'console_logs', 'network_requests']),
}

function isReadOnlyMcpTool(serverId: string, toolName: string) {
  const normalized = toolName.toLowerCase().replace(/^kapturemcp_/, '')
  return READ_ONLY_MCP_TOOLS[serverId]?.has(normalized) || false
}

const serverName = (id: string, label?: string) => SERVER_NAME[id] ?? label ?? plainName(id)

const timeOf = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function ToolsPage() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mcp, setMcp] = useState<McpServerState[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpChecked, setMcpChecked] = useState<Date | null>(null)
  const [kaptureStatus, setKaptureStatus] = useState<KaptureStatus | null>(null)
  const [mcpAudit, setMcpAudit] = useState<McpAuditEntry[]>([])
  const [mcpAuditPath, setMcpAuditPath] = useState('')
  const [desktopApi, setDesktopApi] = useState<ToolsElectronApi | undefined>(undefined)
  const [setupNote, setSetupNote] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const { toast, notify, dismiss } = useToast()
  const isDesktop = !!desktopApi?.isElectron

  // Read the desktop bridge after the page is on screen so the first paint matches the server.
  useEffect(() => { setDesktopApi(getDesktopApi()) }, [])

  const toolsByAgent = useMemo(() => {
    const map: Record<string, ToolDefinition[]> = {}
    for (const tool of snapshot?.tools || []) {
      if (!map[tool.agentId]) map[tool.agentId] = []
      map[tool.agentId].push(tool)
    }
    return map
  }, [snapshot])

  const skillsByAgent = useMemo(() => {
    const map: Record<string, SkillDefinition[]> = {}
    for (const skill of snapshot?.skills || []) {
      if (!map[skill.ownerAgentId]) map[skill.ownerAgentId] = []
      map[skill.ownerAgentId].push(skill)
    }
    return map
  }, [snapshot])

  const loadCapabilities = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai-capabilities', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.data) throw new Error(typeof data.error === 'string' ? data.error : 'The list could not be loaded')
      setSnapshot(data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The list could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMcp = useCallback(async () => {
    setMcpLoading(true)
    setKaptureStatus(null)
    try {
      const data = await desktopApi?.mcp?.tools()
      const servers = data?.servers || []
      setMcp(servers)
      if (desktopApi?.mcp?.auditLog) {
        const audit = await desktopApi.mcp.auditLog(25).catch((err: Error) => ({ ok: false, error: err.message, entries: [], path: '' }))
        setMcpAudit(audit.entries || [])
        setMcpAuditPath(audit.path || '')
      }
      const kapture = servers.find(server => server.id === 'kapture')
      if (kapture?.ok) {
        try {
          const tabsResult = await desktopApi?.mcp?.callTool('kapture', 'list_tabs', {}, false)
          const text = tabsResult?.content?.find(item => item.type === 'text')?.text || '{}'
          const parsed = JSON.parse(text)
          const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : []
          setKaptureStatus({
            ok: !!tabsResult?.ok,
            connectedTabs: tabs.length,
            activeTab: tabs.find((tab: { active?: boolean; title?: string }) => tab.active)?.title || tabs[0]?.title,
            lastError: tabsResult?.ok ? undefined : tabsResult?.error || 'The Chrome link returned an error',
          })
        } catch (err) {
          setKaptureStatus({ ok: false, connectedTabs: 0, lastError: err instanceof Error ? err.message : 'Could not read the Chrome tabs' })
        }
      } else if (kapture) {
        setKaptureStatus({ ok: false, connectedTabs: 0, lastError: kapture.error || 'The Chrome link is not connected' })
      }
    } catch (err) {
      setMcp([{ id: 'desktop', ok: false, error: err instanceof Error ? err.message : 'The check failed' }])
      setKaptureStatus({ ok: false, connectedTabs: 0, lastError: err instanceof Error ? err.message : 'The check failed' })
    } finally {
      setMcpChecked(new Date())
      setMcpLoading(false)
    }
  }, [desktopApi])

  const reconnectMcp = async (serverId?: string) => {
    setMcpLoading(true)
    try {
      await desktopApi?.mcp?.stop(serverId)
      await loadMcp()
      notify(serverId ? `${serverName(serverId)} was restarted.` : 'All desktop connections were restarted.', 'success')
    } catch (err) {
      setMcp(prev => [...prev.filter(m => m.id !== (serverId || 'all')), { id: serverId || 'all', ok: false, error: err instanceof Error ? err.message : 'The restart failed' }])
      setMcpLoading(false)
      notify('The restart did not work. Close and reopen the Alpha Desk desktop app, then check again.', 'error')
    }
  }

  const setUpChrome = async () => {
    setSetupNote(null)
    try {
      const result = await desktopApi?.kapture?.openSetup()
      if (result && result.ok === false) {
        setSetupNote({ kind: 'error', text: result.error || 'The Chrome setup page could not be opened.' })
      } else {
        setSetupNote({ kind: 'info', text: result?.instructions || 'The Chrome setup page is opening. Follow the steps there, then choose Check connections.' })
      }
    } catch (err) {
      setSetupNote({ kind: 'error', text: err instanceof Error ? err.message : 'The Chrome setup page could not be opened.' })
    }
  }

  useEffect(() => { void loadCapabilities() }, [loadCapabilities])
  useEffect(() => { if (isDesktop) void loadMcp() }, [isDesktop, loadMcp])

  const loaded = !!snapshot
  const asksFirst = snapshot?.tools.filter(t => t.requiresConfirmation).length

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Agents and tools</h1>
          <p className="page-subtitle">See which helpers Alpha hands work to, what each one can do, and when it asks you first.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary" onClick={loadCapabilities} disabled={loading}>
            <Icon name="refresh" className="h-5 w-5" />
            {loading ? 'Refreshing…' : 'Refresh list'}
          </button>
          {isDesktop && (
            <>
              <button type="button" className="btn btn-secondary" onClick={loadMcp} disabled={mcpLoading}>
                {mcpLoading ? 'Checking…' : 'Check connections'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => reconnectMcp()} disabled={mcpLoading}>Restart all</button>
              <button type="button" className="btn btn-primary" onClick={setUpChrome}>Set up Chrome link</button>
            </>
          )}
        </div>
      </header>

      {setupNote && (
        <Notice kind={setupNote.kind} className="mb-4 max-w-2xl">
          <p className="whitespace-pre-line break-words">{setupNote.text}</p>
        </Notice>
      )}

      <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
        {[
          { label: 'Agents', value: snapshot?.agents.length, hint: 'Helpers' },
          { label: 'Tools', value: snapshot?.tools.length, hint: 'Actions they can take' },
          { label: 'Skills', value: snapshot?.skills.length, hint: 'Ready-made routines' },
          { label: 'Ask you first', value: asksFirst, hint: 'Tools that wait for a yes' },
        ].map(s => (
          <li key={s.label} className="card !p-3 sm:!p-4">
            <p className="text-[0.875rem] font-bold text-text-secondary">{s.label}</p>
            <p className="display num mt-0.5 text-[1.75rem] font-bold leading-none sm:text-[2rem]">{loaded ? s.value : '–'}</p>
            <p className="mt-1 text-[0.8125rem] text-text-secondary">{s.hint}</p>
          </li>
        ))}
      </ul>

      <section className="mb-8" aria-labelledby="desktop-h">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="desktop-h" className="section-title">Desktop connections</h2>
          <Status lamp={isDesktop ? 'green' : 'off'}>{isDesktop ? 'Desktop app detected' : 'Browser only'}</Status>
        </div>

        {!isDesktop ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
            <p className="text-[0.9375rem] text-text-secondary">These checks only work in the Alpha Desk desktop app. Open this page there to see the Windows and Chrome connections Alpha can use on that computer. Everything else on this page works here.</p>
          </div>
        ) : mcpLoading && mcp.length === 0 && !kaptureStatus ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true" role="status" aria-label="Checking connections">
            <div className="skeleton h-32" /><div className="skeleton h-32" />
          </div>
        ) : (
          <>
            {mcpChecked && <p className="mb-2 text-[0.875rem] text-text-secondary">{mcpLoading ? 'Checking again…' : `Last checked at ${timeOf(mcpChecked)}.`}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {kaptureStatus && (
                <div className="card md:col-span-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">Chrome tabs Alpha can use</h3>
                      <p className="text-[0.875rem] text-text-secondary">The Chrome extension that lets Alpha work in your browser</p>
                    </div>
                    <Status lamp={kaptureStatus.ok && kaptureStatus.connectedTabs > 0 ? 'green' : 'amber'}>
                      {kaptureStatus.connectedTabs} connected
                    </Status>
                  </div>
                  <dl className="mt-3 grid gap-3 text-[0.9375rem] md:grid-cols-3">
                    <div><dt className="text-[0.8125rem] font-bold text-text-secondary">Link</dt><dd>{kaptureStatus.ok ? 'Running' : 'Needs attention'}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.8125rem] font-bold text-text-secondary">Active tab</dt><dd className="break-words">{kaptureStatus.activeTab || 'None'}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.8125rem] font-bold text-text-secondary">Last problem</dt><dd className="break-words">{kaptureStatus.lastError || 'None'}</dd></div>
                  </dl>
                  {kaptureStatus.connectedTabs === 0 && (
                    <p className="mt-3 text-[0.9375rem] text-text-secondary">No tab is connected. Choose Set up Chrome link, then open the extension in the Chrome tab you want Alpha to use.</p>
                  )}
                </div>
              )}
              {mcp.map(server => {
                const serverTools = server.tools || []
                return (
                  <div key={server.id} className="card flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold">{serverName(server.id, server.label)}</h3>
                        <p className="text-[0.875rem] text-text-secondary">{server.description || 'Desktop connection'}</p>
                      </div>
                      <Status lamp={server.ok ? 'green' : 'red'}>{server.ok ? 'Connected' : 'Not working'}</Status>
                    </div>
                    {server.error && <p className="mt-3 break-words text-[0.9375rem] text-red">{server.error}</p>}
                    <p className="mt-3 text-[0.9375rem] text-text-secondary">{plural(serverTools.length, 'tool')} found</p>
                    {serverTools.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {serverTools.slice(0, 12).map(tool => {
                          const readOnly = isReadOnlyMcpTool(server.id, tool.name)
                          return <Tag key={tool.name} tone={readOnly ? 'green' : 'amber'}>{plainName(tool.name.replace(/^kapturemcp_/i, ''))}, {readOnly ? 'reads only' : 'takes action'}</Tag>
                        })}
                        {serverTools.length > 12 && <Tag>and {serverTools.length - 12} more</Tag>}
                      </div>
                    )}
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <button type="button" className="btn btn-secondary" disabled={mcpLoading} onClick={() => reconnectMcp(server.id)}>Restart</button>
                      <button type="button" className="btn btn-secondary" disabled={mcpLoading} onClick={loadMcp}>Check again</button>
                    </div>
                  </div>
                )
              })}
              {mcp.length === 0 && !kaptureStatus && (
                <div className="md:col-span-2"><EmptyBlock icon="plug" title="No desktop connections found">Choose Check connections to look again, or Set up Chrome link to connect your browser.</EmptyBlock></div>
              )}
            </div>
          </>
        )}
      </section>

      {isDesktop && (
        <section className="mb-8" aria-labelledby="audit-h">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 id="audit-h" className="section-title">Recent tool calls on this computer</h2>
              {mcpAuditPath && <p className="break-all text-[0.8125rem] text-text-secondary">Log file: {mcpAuditPath}</p>}
            </div>
            <Tag tone={mcpAudit.length ? 'green' : 'neutral'}>{plural(mcpAudit.length, 'recent call')}</Tag>
          </div>
          {mcpAudit.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[0.9375rem] text-text-secondary">Alpha has not used any desktop tools on this computer yet. Calls will be listed here with whether they worked and whether you approved them.</p>
          ) : (
            <ul className="ledger">
              {mcpAudit.slice().reverse().map((entry, index) => (
                <li key={`${entry.timestamp}-${entry.server}-${entry.tool}-${index}`} className="px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 font-bold">{serverName(entry.server || 'desktop')}: {plainName(entry.tool || 'tool').toLowerCase()}</p>
                    <Status lamp={entry.ok ? 'green' : 'red'}>{entry.ok ? 'Worked' : 'Failed'}</Status>
                  </div>
                  <p className="text-[0.875rem] text-text-secondary">{entry.timestamp && !Number.isNaN(new Date(entry.timestamp).getTime()) ? new Date(entry.timestamp).toLocaleString() : 'Time unknown'}</p>
                  <p className="mt-1 break-words text-[0.9375rem] text-text-secondary">
                    {entry.approvalRequired ? (entry.approved ? 'You approved it.' : 'It needed your approval.') : 'No approval needed.'}
                    {entry.cancelled ? ' It was cancelled.' : ''}
                    {entry.error ? ` ${entry.error}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="agents-h">
        <h2 id="agents-h" className="section-title mb-2">Agents</h2>
        {loading && !snapshot ? (
          <div className="space-y-2" aria-busy="true" role="status" aria-label="Loading agents">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[5.5rem]" />)}
          </div>
        ) : error && !snapshot ? (
          <ErrorCard title="The agent list did not load" message={`${error.replace(/[.\s]+$/, '')}. Check your connection and try again.`} onRetry={loadCapabilities} busy={loading} className="max-w-xl" />
        ) : snapshot && snapshot.agents.length === 0 ? (
          <EmptyBlock icon="tools" title="No agents are set up yet">When agents are added they will show here with their tools and skills.</EmptyBlock>
        ) : (
          <div className="space-y-2">
            {error && <ErrorCard message={`${error.replace(/[.\s]+$/, '')}. The list below may be out of date.`} onRetry={loadCapabilities} busy={loading} />}
            {snapshot && <AgentList agents={snapshot.agents} toolsByAgent={toolsByAgent} skillsByAgent={skillsByAgent} />}
          </div>
        )}
      </section>

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
