'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentDefinition, PermissionLevel, SkillDefinition, ToolDefinition } from '@/lib/ai/capabilities'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'

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

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue'

/** A small labelled pill. Always carries words. */
function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const cls = { neutral: 'tag-gray', green: 'tag-green', amber: 'tag-amber', red: 'tag-red', blue: 'tag-blue' }[tone]
  return <span className={`tag ${cls} max-w-full text-[0.8125rem]`}><span className="min-w-0 truncate">{children}</span></span>
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

const PERMISSION_LABEL: Record<PermissionLevel, { label: string; tone: Tone }> = {
  read: { label: 'Reads only', tone: 'green' },
  write: { label: 'Changes data', tone: 'blue' },
  external: { label: 'Contacts others', tone: 'amber' },
  destructive: { label: 'Deletes data', tone: 'red' },
  sensitive: { label: 'Sensitive data', tone: 'amber' },
}

const humanize = (name: string) => name.replace(/[_-]+/g, ' ')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export default function ToolsPage() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mcp, setMcp] = useState<McpServerState[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [kaptureStatus, setKaptureStatus] = useState<KaptureStatus | null>(null)
  const [mcpAudit, setMcpAudit] = useState<McpAuditEntry[]>([])
  const [mcpAuditPath, setMcpAuditPath] = useState('')
  const [desktopApi, setDesktopApi] = useState<ToolsElectronApi | undefined>(undefined)
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
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load capabilities')
      setSnapshot(data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load capabilities')
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
            lastError: tabsResult?.ok ? undefined : tabsResult?.error || 'Kapture list_tabs returned an error',
          })
        } catch (err) {
          setKaptureStatus({ ok: false, connectedTabs: 0, lastError: err instanceof Error ? err.message : 'Could not read Kapture tabs' })
        }
      } else if (kapture) {
        setKaptureStatus({ ok: false, connectedTabs: 0, lastError: kapture.error || 'Kapture MCP server is not connected' })
      }
    } catch (err) {
      setMcp([{ id: 'desktop', ok: false, error: err instanceof Error ? err.message : 'MCP check failed' }])
      setKaptureStatus({ ok: false, connectedTabs: 0, lastError: err instanceof Error ? err.message : 'MCP check failed' })
    } finally {
      setMcpLoading(false)
    }
  }, [desktopApi])

  const reconnectMcp = async (serverId?: string) => {
    setMcpLoading(true)
    try {
      await desktopApi?.mcp?.stop(serverId)
      await loadMcp()
    } catch (err) {
      setMcp(prev => [...prev, { id: serverId || 'all', ok: false, error: err instanceof Error ? err.message : 'Reconnect failed' }])
      setMcpLoading(false)
    }
  }

  useEffect(() => { void loadCapabilities() }, [loadCapabilities])
  useEffect(() => { if (isDesktop) void loadMcp() }, [isDesktop, loadMcp])

  const loaded = !!snapshot

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
              <button type="button" className="btn btn-secondary" onClick={() => reconnectMcp()} disabled={mcpLoading}>Reconnect all</button>
              <button type="button" className="btn btn-primary" onClick={() => desktopApi?.kapture?.openSetup()}>Set up Chrome link</button>
            </>
          )}
        </div>
      </header>

      <ul className="mb-8 grid grid-cols-3 gap-3" aria-label="Totals">
        {[
          { label: 'Agents', value: snapshot?.agents.length, hint: 'Helpers' },
          { label: 'Tools', value: snapshot?.tools.length, hint: 'Actions' },
          { label: 'Skills', value: snapshot?.skills.length, hint: 'Routines' },
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
            <p className="text-[0.9375rem] text-text-secondary">These checks only work in the Alpha Desk desktop app. Open this page there to see the Windows and Chrome connections Alpha can use on that computer.</p>
          </div>
        ) : mcpLoading && mcp.length === 0 && !kaptureStatus ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true" role="status" aria-label="Checking connections">
            <div className="skeleton h-32" /><div className="skeleton h-32" />
          </div>
        ) : (
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
              </div>
            )}
            {mcp.map(server => {
              const serverTools = server.tools || []
              return (
                <div key={server.id} className="card flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold">{server.label || server.id}</h3>
                      <p className="text-[0.875rem] text-text-secondary">{server.description || 'Desktop connection'}</p>
                    </div>
                    <Status lamp={server.ok ? 'green' : 'red'}>{server.ok ? 'Connected' : 'Not working'}</Status>
                  </div>
                  {server.error && <p className="mt-3 text-[0.9375rem] text-red">{server.error}</p>}
                  <p className="mt-3 text-[0.9375rem] text-text-secondary">{plural(serverTools.length, 'tool')} found</p>
                  {serverTools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {serverTools.slice(0, 12).map(tool => {
                        const readOnly = isReadOnlyMcpTool(server.id, tool.name)
                        return <Tag key={tool.name} tone={readOnly ? 'green' : 'amber'}>{humanize(tool.name)}, {readOnly ? 'reads only' : 'takes action'}</Tag>
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
              <div className="md:col-span-2"><EmptyBlock icon="plug" title="No desktop connections found">Tap Check connections to look again, or Set up Chrome link to connect your browser.</EmptyBlock></div>
            )}
          </div>
        )}
      </section>

      {isDesktop && (
        <section className="mb-8" aria-labelledby="audit-h">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="audit-h" className="section-title">Recent tool calls on this computer</h2>
              {mcpAuditPath && <p className="break-all text-[0.8125rem] text-text-secondary">Saved at {mcpAuditPath}</p>}
            </div>
            <Tag tone={mcpAudit.length ? 'green' : 'neutral'}>{plural(mcpAudit.length, 'recent call')}</Tag>
          </div>
          {mcpAudit.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[0.9375rem] text-text-secondary">Alpha has not used any desktop tools on this computer yet.</p>
          ) : (
            <ul className="ledger">
              {mcpAudit.slice().reverse().map((entry, index) => (
                <li key={`${entry.timestamp}-${entry.server}-${entry.tool}-${index}`} className="px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 font-bold">{entry.server || 'Server'}: {humanize(entry.tool || 'tool')}</p>
                    <Status lamp={entry.ok ? 'green' : 'red'}>{entry.ok ? 'Worked' : 'Failed'}</Status>
                  </div>
                  <p className="text-[0.875rem] text-text-secondary">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Time unknown'}</p>
                  <p className="mt-1 text-[0.9375rem] text-text-secondary">
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
          <ErrorCard title="The agent list did not load" message={`${error}. Check your connection and try again.`} onRetry={loadCapabilities} busy={loading} className="max-w-xl" />
        ) : snapshot && snapshot.agents.length === 0 ? (
          <EmptyBlock icon="tools" title="No agents are set up yet">When agents are added they will show here with their tools and skills.</EmptyBlock>
        ) : (
          <div className="space-y-2">
            {error && <ErrorCard message={`${error}. The list below may be out of date.`} onRetry={loadCapabilities} busy={loading} />}
            {snapshot?.agents.map(agent => {
              const tools = toolsByAgent[agent.id] || []
              const skills = skillsByAgent[agent.id] || []
              return (
                <details key={agent.id} className="panel group">
                  <summary className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-lg px-4 py-3 hover:bg-bg-hover [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="section-title block">{agent.name}</span>
                      <span className="mt-0.5 block text-[0.9375rem] text-text-secondary">{agent.purpose}</span>
                      <span className="mt-1 block text-[0.875rem] font-bold text-text-secondary">{plural(tools.length, 'tool')} · {plural(skills.length, 'skill')}</span>
                    </span>
                    <Icon name="chevronDown" className="h-5 w-5 shrink-0 text-text-secondary transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="border-t border-border p-4">
                    {agent.owns.length > 0 && (
                      <p className="mb-4 text-[0.9375rem] text-text-secondary"><span className="font-bold text-text-primary">Looks after: </span>{agent.owns.join(', ')}</p>
                    )}
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 font-bold">Tools</h3>
                        {tools.length === 0 ? (
                          <p className="text-[0.9375rem] text-text-secondary">This agent has no tools of its own.</p>
                        ) : (
                          <ul className="ledger">
                            {tools.map(tool => {
                              const perm = PERMISSION_LABEL[tool.permission] || { label: tool.permission, tone: 'neutral' as Tone }
                              return (
                                <li key={tool.name} className="px-1 py-3">
                                  <p className="font-bold" title={tool.name}>{humanize(tool.name)}</p>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    <Tag tone={perm.tone}>{perm.label}</Tag>
                                    {tool.requiresConfirmation && <Tag tone="amber">Asks you first</Tag>}
                                    {tool.audit && <Tag>Logged</Tag>}
                                  </div>
                                  <p className="mt-1.5 text-[0.9375rem] text-text-secondary">{tool.description}</p>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h3 className="mb-2 font-bold">Skills</h3>
                        {skills.length === 0 ? (
                          <p className="text-[0.9375rem] text-text-secondary">This agent has no ready-made skills.</p>
                        ) : (
                          <ul className="ledger">
                            {skills.map(skill => (
                              <li key={skill.id} className="px-1 py-3">
                                <p className="font-bold">{skill.name}</p>
                                <p className="mt-1 text-[0.9375rem] text-text-secondary">{skill.description}</p>
                                {skill.requiredTools.length > 0 && (
                                  <p className="mt-1.5 text-[0.875rem] text-text-secondary"><span className="font-bold">Uses: </span>{skill.requiredTools.map(humanize).join(', ')}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
