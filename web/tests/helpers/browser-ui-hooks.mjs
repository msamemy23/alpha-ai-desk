// Lets `node --test` draw the Browser screen's React files on the server, with no browser and no network:
//  - "@/..." and files imported without an ending are found under src,
//  - .ts and .tsx files are turned into plain JavaScript with TypeScript itself,
//  - "next/navigation" is replaced by a small stand-in (the screen is drawn once, nothing navigates).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))
const STUB = new URL('./next-navigation-stub.mjs', import.meta.url).href
const ts = createRequire(import.meta.url)('typescript')

function isFile(p) {
  try { return statSync(p).isFile() } catch { return false }
}

function find(base) {
  for (const ending of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ending
    if (existsSync(p) && isFile(p)) return p
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/navigation') return { url: STUB, shortCircuit: true }
  let base = null
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2))
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file://') && fileURLToPath(context.parentURL).startsWith(SRC)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
  }
  const found = base ? find(base) : null
  if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file://') && /\.tsx?$/.test(url) && fileURLToPath(url).startsWith(SRC)) {
    const file = fileURLToPath(url)
    const out = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
    })
    return { format: 'module', source: out.outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
