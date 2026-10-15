'use client'
import type { ReactNode } from 'react'
import type { AgentDefinition, SkillDefinition, ToolDefinition } from '@/lib/ai/capabilities'
import { plainName, sentenceTitle } from '@/lib/connector-messages'
import Icon from '@/components/Icon'
import { AGENT_PURPOSE, PERMISSION_LABEL, SKILL_COPY, TOOL_COPY, type Tone } from './copy'

/** A small labelled pill. Always carries words. */
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const cls = { neutral: 'tag-gray', green: 'tag-green', amber: 'tag-amber', red: 'tag-red', blue: 'tag-blue' }[tone]
  return <span className={`tag ${cls} max-w-full text-[0.8125rem]`}><span className="min-w-0 truncate">{children}</span></span>
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export const toolName = (name: string) => TOOL_COPY[name]?.name ?? plainName(name)

/** One expandable row per helper, with what it can do and the routines it knows. */
export default function AgentList({
  agents, toolsByAgent, skillsByAgent,
}: {
  agents: AgentDefinition[]
  toolsByAgent: Record<string, ToolDefinition[]>
  skillsByAgent: Record<string, SkillDefinition[]>
}) {
  return (
    <div className="space-y-2">
      {agents.map(agent => {
        const tools = toolsByAgent[agent.id] || []
        const skills = skillsByAgent[agent.id] || []
        const purpose = AGENT_PURPOSE[agent.id] ?? agent.purpose
        const asksFirst = tools.filter(t => t.requiresConfirmation).length
        return (
          <details key={agent.id} className="panel group">
            <summary className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-lg px-4 py-3 hover:bg-bg-hover [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="section-title block">{sentenceTitle(agent.name)}</span>
                <span className="mt-0.5 block text-[0.9375rem] text-text-secondary">{purpose}</span>
                <span className="mt-1 block text-[0.875rem] font-bold text-text-secondary">
                  {plural(tools.length, 'tool')} · {plural(skills.length, 'skill')}{asksFirst > 0 ? ` · ${asksFirst} ask${asksFirst === 1 ? 's' : ''} you first` : ''}
                </span>
              </span>
              <Icon name="chevronDown" className="h-5 w-5 shrink-0 text-text-secondary transition-transform group-open:rotate-180" />
            </summary>

            <div className="border-t border-border p-4">
              {!AGENT_PURPOSE[agent.id] && agent.owns.length > 0 && (
                <p className="mb-4 text-[0.9375rem] text-text-secondary"><span className="font-bold text-text-primary">Looks after: </span>{agent.owns.join(', ')}</p>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 font-bold">Tools</h3>
                  {tools.length === 0 ? (
                    <p className="text-[0.9375rem] text-text-secondary">This helper has no tools of its own. It works through the others.</p>
                  ) : (
                    <ul className="ledger">
                      {tools.map(tool => {
                        const perm = PERMISSION_LABEL[tool.permission] || { label: tool.permission, tone: 'neutral' as Tone }
                        return (
                          <li key={tool.name} className="px-1 py-3">
                            <p className="font-bold">{toolName(tool.name)}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <Tag tone={perm.tone}>{perm.label}</Tag>
                              {tool.requiresConfirmation && <Tag tone="amber">Asks you first</Tag>}
                              {tool.audit && <Tag>Logged</Tag>}
                            </div>
                            <p className="mt-1.5 text-[0.9375rem] text-text-secondary">{TOOL_COPY[tool.name]?.what ?? tool.description}</p>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 font-bold">Skills</h3>
                  {skills.length === 0 ? (
                    <p className="text-[0.9375rem] text-text-secondary">This helper has no ready-made skills.</p>
                  ) : (
                    <ul className="ledger">
                      {skills.map(skill => {
                        const copy = SKILL_COPY[skill.id]
                        return (
                          <li key={skill.id} className="px-1 py-3">
                            <p className="font-bold">{copy?.name ?? sentenceTitle(skill.name, ['Kapture'])}</p>
                            <p className="mt-1 text-[0.9375rem] text-text-secondary">{copy?.what ?? skill.description}</p>
                            {skill.examples.length > 0 && (
                              <p className="mt-1.5 text-[0.875rem] text-text-secondary"><span className="font-bold">Try asking Alpha: </span>{skill.examples.slice(0, 2).map(e => `“${e}”`).join(', ')}</p>
                            )}
                            {skill.requiredTools.length > 0 && (
                              <p className="mt-1 text-[0.875rem] text-text-secondary"><span className="font-bold">Uses: </span>{skill.requiredTools.map(toolName).join(', ')}</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </details>
        )
      })}
    </div>
  )
}
