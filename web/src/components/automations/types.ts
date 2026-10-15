export interface ConfigField {
  key: string
  label: string
  type: 'number' | 'text' | 'boolean' | 'textarea' | 'select'
  default: unknown
  options?: string[]
}

export type RunStatus = 'ok' | 'error' | 'never'

export interface SystemAutomation {
  id: string
  name: string
  description: string
  category: string
  schedule: string
  icon: string
  requires?: string[]
  configFields: ConfigField[]
  state: {
    enabled: boolean
    config: Record<string, unknown>
    last_run: string | null
    run_count: number
    last_result: string | null
    last_status: RunStatus
  }
}

export interface CustomAutomation {
  id: string
  name: string
  description: string
  schedule: string
  task_prompt: string
  enabled: boolean
  last_run: string | null
  next_run: string | null
  run_count: number
  status: string
  last_result?: string
  created_at: string
}

/** What the shop has saved that the texts are built from. */
export interface ShopFacts {
  name: string
  phone: string
  reviewUrl: string
  timezone: string
  state: 'loading' | 'ready' | 'error'
}

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'
