import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadTsModule(relativePath, stubs = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const testModule = { exports: {} }
  const sandbox = {
    exports: testModule.exports,
    module: testModule,
    require: (id) => {
      if (id in stubs) return stubs[id]
      throw new Error(`Unexpected import in test module: ${id}`)
    },
  }

  vm.runInNewContext(compiled, sandbox, { filename: relativePath })
  return testModule.exports
}

const desktopActions = loadTsModule('../src/lib/ai/desktop-actions.ts')
const aiPage = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')

test('image requests extract the object instead of saving browser filler words', () => {
  const request = desktopActions.parseDesktopImageRequest(
    'open chrome and search for a picture of pikachu. download it on to my desktop'
  )

  assert.equal(request?.query, 'pikachu')
  assert.equal(request?.filename, 'pikachu.png')
  assert.equal(request?.open, false)
})

test('image requests only open the file when the user asks to open the saved file', () => {
  assert.equal(desktopActions.parseDesktopImageRequest('download a picture of pikachu and open it')?.open, true)
  assert.equal(desktopActions.parseDesktopImageRequest('open chrome and find a picture of pikachu')?.open, false)
})

test('browser requests preserve Comet target and useful search terms', () => {
  const request = desktopActions.parseBrowserRequest(
    'open comet browser and search for brake for 2004 honda accord. all four brakes'
  )

  assert.equal(request?.app, 'comet')
  assert.match(request?.url || '', /^https:\/\/www\.google\.com\/search\?q=/)
  assert.match(request?.query || '', /2004 Honda accord/i)
  assert.match(request?.query || '', /brake/i)
})

test('parts requests normalize shorthand years and all-four-brakes scope', () => {
  const query = desktopActions.normalizePartsQuery(
    'open comet browser and search for brake for 04 civic. all four brakes'
  )

  assert.match(query, /2004 Honda civic/i)
  assert.match(query, /front and rear brake pads and rotors/i)
  assert.match(desktopActions.normalizePartsQuery('find brakes for 99 accord'), /1999 Honda accord/i)
})

test('desktop actions require verified tool results before claiming success', () => {
  assert.equal(desktopActions.isVerifiedBrowserOpen({ ok: true, path: 'C:/Chrome/chrome.exe' }), false)
  assert.equal(
    desktopActions.isVerifiedBrowserOpen({
      ok: true,
      verified: true,
      path: 'C:/Chrome/chrome.exe',
      processRunning: true,
    }),
    true
  )

  assert.equal(desktopActions.isVerifiedDownloadResult({ ok: true, path: 'C:/Users/aaron/Desktop/pikachu.png' }), false)
  assert.equal(
    desktopActions.isVerifiedDownloadResult({
      ok: true,
      verified: true,
      path: 'C:/Users/aaron/Desktop/pikachu.png',
      fileExists: true,
      bytes: 128,
    }),
    true
  )
})

test('AI page no longer tells the model to claim ok-only desktop success', () => {
  assert.match(aiPage, /formatBrowserOpenResult/)
  assert.match(aiPage, /formatDownloadResult/)
  assert.match(aiPage, /isVerifiedBrowserOpen/)
  assert.match(aiPage, /isVerifiedDownloadResult/)
  assert.doesNotMatch(aiPage, /If ok:true, tell the user it opened/)
  assert.doesNotMatch(aiPage, /If ok:true, tell the user the exact saved path/)
})
