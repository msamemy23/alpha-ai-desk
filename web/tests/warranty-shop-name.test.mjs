import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WARRANTY_PRESETS, renderWarrantyText } from '../src/lib/doc-warranty.ts'

const page = readFileSync(new URL('../src/components/DocumentsPage.tsx', import.meta.url), 'utf8')

test('warranty presets name no shop, and every {shop} is filled with the shop\'s own name', () => {
  const withMarker = WARRANTY_PRESETS.filter(p => p.exclusions.includes('{shop}'))
  assert.ok(withMarker.length > 0, 'the presets use the {shop} marker')
  for (const p of WARRANTY_PRESETS) {
    assert.doesNotMatch(p.exclusions, /Alpha|Houston|713/, `${p.label} names no shop`)
    const text = renderWarrantyText(p.exclusions, 'Ace Auto Repair')
    assert.doesNotMatch(text, /\{shop\}/)
  }
  assert.match(renderWarrantyText('Call {shop} first.', ''), /Call our shop first\./)
})

test('the document editor fills {shop} through the shared helper before a warranty is saved or printed', () => {
  const fn = page.slice(page.indexOf('const formatWarrantyText'), page.indexOf('const dirty ='))
  assert.match(fn, /fillWarrantyText\(value, \{ name: shopName, address: shopAddress, phone: shopPhone \}\)/)
  assert.match(page, /import \{ fillWarrantyText \} from '@\/lib\/warranty-text'/)
})
