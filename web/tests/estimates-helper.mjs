// Loads the estimate and invoice TypeScript libraries for node:test without a build step.
// Imports written as '@/lib/name' resolve to src/lib/name.ts; everything else must be stubbed.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const cache = new Map()

export function loadLib(name, stubs = {}) {
  const key = name
  if (cache.has(key) && Object.keys(stubs).length === 0) return cache.get(key)
  const url = new URL(`../src/lib/${name}.ts`, import.meta.url)
  const source = readFileSync(url, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const sandbox = {
    exports: mod.exports,
    module: mod,
    TextEncoder,
    crypto: globalThis.crypto,
    require: (id) => {
      if (id in stubs) return stubs[id]
      const m = id.match(/^@\/lib\/(.+)$/)
      if (m) return loadLib(m[1], stubs)
      throw new Error(`Unexpected import in ${name}: ${id}`)
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(compiled, sandbox, { filename: `${name}.ts` })
  if (Object.keys(stubs).length === 0) cache.set(key, mod.exports)
  return mod.exports
}

export const money = () => loadLib('document-money')
