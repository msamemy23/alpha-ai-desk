'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AgentDefinition, SkillDefinition, ToolDefinition } from '@/lib/ai/capabilities'

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

interface ToolsElectronApi {
  isElectron?: boolean
  mcp?: {
    tools: (server?: string) => Promise<{ ok?: boolean; servers?: McpServerState[]; error?: string }>
    resources: (server?: string) => Promise<Record<string, unknown>>
    prompts: (server?: string) => Promise<Record<string, unknown>>
    callTool: (server: string, name: string, args?: Record<string, unknown>, approved?: boolean) => Promise<{ ok?: boolean; content?: Array<{ type?: string; text?: string }>; error?: string }>
    stop: (server?: string) => Promise<{ ok?: boolean; error?: string }>
  }
  kapture?: { openSetup: () => Promise<{ ok?: boolean; error?: string; instructions?: string }> }
}

function getDesktopApi() {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: ToolsElectronApi }).electronAPI
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  const cls = {
    neutral: 'border-white/10 bg-white/[0.04] text-text-secondary',
    green: 'border-green/30 bg-green/10 text-green',
    amber: 'border-amber/30 bg-amber/10 text-amber',
    red: 'border-red/30 bg-red/10 text-red',
    blue: 'border-blue/30 bg-blue/10 text-blue',
  }[tone]
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-bold ${cls}`}>{children}</span>
}

const READ_ONLY_MCP_TOOLS: Record<string, Set<string>> = {
  windows: new Set(['snapshot', 'screenshot', 'scrape']),
  kapture: new Set(['list_tabs', 'tab_detail', 'dom', 'elements', 'screenshot', 'console_logs', 'network_requests']),
}

function isReadOnlyMcpTool(serverId: string, toolName: string) {
  const normalized = toolName.toLowerCase().replace(/^kapturemcp_/, '')
  return READ_ONLY_MCP_TOOLS[serverId]?.has(normalized) || false
}

export default function ToolsPage() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mcp, setMcp] = useState<McpServerState[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [kaptureStatus, setKaptureStatus] = useState<KaptureStatus | null>(null)
  const desktopApi = getDesktopApi()
  const isDesktop = !!desktopApi?.isElectron

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

  const loadCapabilities = async () => {
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
  }

  const loadMcp = async () => {
    setMcpLoading(true)
    setKaptureStatus(null)
    try {
      const data = await desktopApi?.mcp?.tools()
      const servers = data?.servers || []
      setMcp(servers)
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
  }

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

  useEffect(() => { void loadCapabilities() }, [])
  useEffect(() => { if (isDesktop) void loadMcp() }, [isDesktop])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-blue">Alpha AI Control Plane</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Agents, Tools, Skills</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
            This is the live capability map Alpha AI uses for routing, permissions, MCP health, and reusable workflows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadCapabilities} disabled={loading}>Refresh Registry</button>
          <button className="btn btn-secondary btn-sm" onClick={loadMcp} disabled={!isDesktop || mcpLoading}>
            {mcpLoading ? 'Checking MCP...' : 'Check MCP'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => reconnectMcp()} disabled={!isDesktop || mcpLoading}>Reconnect All</button>
          <button className="btn btn-primary btn-sm" onClick={() => desktopApi?.kapture?.openSetup()} disabled={!isDesktop}>Kapture Setup</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red/30 bg-red/10 p-3 text-sm text-red">{error}</div>}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="text-xs font-bold uppercase text-text-muted">Agents</div>
          <div className="mt-2 text-3xl font-black">{snapshot?.agents.length || 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="text-xs font-bold uppercase text-text-muted">Registered Tools</div>
          <div className="mt-2 text-3xl font-black">{snapshot?.tools.length || 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="text-xs font-bold uppercase text-text-muted">Skills</div>
          <div className="mt-2 text-3xl font-black">{snapshot?.skills.length || 0}</div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-black">MCP Health</h2>
          <Pill tone={isDesktop ? 'green' : 'amber'}>{isDesktop ? 'Desktop bridge detected' : 'Web only'}</Pill>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {!isDesktop && <div className="text-sm text-text-secondary">Open this page inside Alpha AI Desk desktop to inspect Windows-MCP and Kapture.</div>}
          {kaptureStatus && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-bold">Kapture Connected Tabs</div>
                  <div className="mt-1 text-xs text-text-muted">Chrome extension tab bridge status</div>
                </div>
                <Pill tone={kaptureStatus.ok && kaptureStatus.connectedTabs > 0 ? 'green' : 'amber'}>
                  {kaptureStatus.connectedTabs} connected
                </Pill>
              </div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                <div><span className="text-text-muted">Server:</span> {kaptureStatus.ok ? 'running' : 'needs attention'}</div>
                <div><span className="text-text-muted">Active tab:</span> {kaptureStatus.activeTab || 'none'}</div>
                <div><span className="text-text-muted">Last error:</span> {kaptureStatus.lastError || 'none'}</div>
              </div>
            </div>
          )}
          {mcp.map(server => (
            <div key={server.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{server.label || server.id}</div>
                  <div className="mt-1 text-xs text-text-muted">{server.description || 'MCP server'}</div>
                </div>
                <Pill tone={server.ok ? 'green' : 'red'}>{server.ok ? 'Connected' : 'Error'}</Pill>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-secondary btn-sm" disabled={!isDesktop || mcpLoading} onClick={() => reconnectMcp(server.id)}>Restart</button>
                <button className="btn btn-secondary btn-sm" disabled={!isDesktop || mcpLoading} onClick={loadMcp}>Refresh</button>
              </div>
              {server.error && <div className="mt-3 text-sm text-red">{server.error}</div>}
              <div className="mt-3 text-xs text-text-secondary">{server.tools?.length || 0} tools discovered</div>
              <div className="mt-3 flex flex-wrap gap-1">
                {(server.tools || []).slice(0, 12).map(tool => (
                  <Pill key={tool.name} tone={isReadOnlyMcpTool(server.id, tool.name) ? 'green' : 'amber'}>
                    {tool.name} {isReadOnlyMcpTool(server.id, tool.name) ? 'read' : 'action'}
                  </Pill>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-border bg-bg-card p-6 text-sm text-text-secondary">Loading capability registry...</div>
      ) : (
        <section className="space-y-3">
          {snapshot?.agents.map(agent => (
            <div key={agent.id} className="rounded-lg border border-border bg-bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black">{agent.name}</h2>
                    <Pill tone="blue">{agent.id}</Pill>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{agent.purpose}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {agent.owns.map(item => <Pill key={item}>{item}</Pill>)}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-black uppercase text-text-muted">Tools</div>
                  <div className="space-y-2">
                    {(toolsByAgent[agent.id] || []).map(tool => (
                      <div key={tool.name} className="rounded-md border border-white/10 bg-white/[0.025] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{tool.name}</span>
                          <Pill tone={tool.requiresConfirmation ? 'amber' : tool.permission === 'read' ? 'green' : 'blue'}>{tool.permission}</Pill>
                          {tool.audit && <Pill>audit</Pill>}
                          {tool.requiresConfirmation && <Pill tone="amber">confirmation</Pill>}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-text-secondary">{tool.description}</div>
                      </div>
                    ))}
                    {!(toolsByAgent[agent.id] || []).length && <div className="text-sm text-text-muted">No direct tools registered.</div>}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-black uppercase text-text-muted">Skills</div>
                  <div className="space-y-2">
                    {(skillsByAgent[agent.id] || []).map(skill => (
                      <div key={skill.id} className="rounded-md border border-white/10 bg-white/[0.025] p-3">
                        <div className="font-bold">{skill.name}</div>
                        <div className="mt-2 text-xs leading-5 text-text-secondary">{skill.description}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {skill.requiredTools.map(tool => <Pill key={tool}>{tool}</Pill>)}
                        </div>
                      </div>
                    ))}
                    {!(skillsByAgent[agent.id] || []).length && <div className="text-sm text-text-muted">No default skills registered.</div>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
