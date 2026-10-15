import test from 'node:test'
import assert from 'node:assert/strict'
import { blockCsv, blocksCsv, csvValue, emailHtml, esc, fileName, formatCell, plainText, printableHtml } from '../src/lib/report-files.ts'

const block = {
  id: 't', heading: 'Sales by advisor', note: 'Before tax.',
  columns: [{ label: 'Advisor', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Sales', kind: 'money' }, { label: 'Share', kind: 'pct' }, { label: 'Hours', kind: 'hours' }],
  rows: [['Dana', 3, 1234.5, 66.666, 2.5], ['=SUM(A1)', 1, -5, null, 0.333]],
  footer: ['Total', 4, 1229.5, 100, null],
}
const bundle = { title: 'Shop summary', subtitle: 'Oct 1 to Oct 14, 2026', shopName: 'Test Shop <b>', generated: 'Made Oct 14, 2026.', headline: 'You collected $637 this month.', bullets: ['One <script>alert(1)</script> thing'], blocks: [block, { id: 'e', heading: 'Empty one', columns: block.columns, rows: [], empty: 'Nothing here.' }], notes: ['A "note" & more'] }

test('cells read the way a person expects on screen', () => {
  assert.equal(formatCell(1234.5, 'money'), '$1,234.50')
  assert.equal(formatCell(-5, 'money'), '-$5.00')
  assert.equal(formatCell(1234, 'int'), '1,234')
  assert.equal(formatCell(66.666, 'pct'), '66.7%')
  assert.equal(formatCell(2.5, 'hours'), '2.5')
  assert.equal(formatCell(null, 'money'), '–')
  assert.equal(formatCell(null, 'text'), '')
  assert.equal(formatCell({ n: 12, kind: 'int' }, 'money'), '12', 'a cell can override its column')
  assert.equal(formatCell({ n: 12.5, kind: 'money' }, 'int'), '$12.50')
})

test('the csv carries plain numbers a spreadsheet can add up', () => {
  assert.equal(csvValue(1234.5, 'money'), '1234.50')
  assert.equal(csvValue(2.5, 'hours'), 2.5)
  assert.equal(csvValue(null, 'money'), '')
  assert.equal(csvValue({ n: 3, kind: 'int' }, 'money'), 3)
  const lines = blockCsv(block).trim().split('\r\n')
  assert.equal(lines[0], 'Advisor,Invoices,Sales,Share,Hours')
  assert.equal(lines[1], 'Dana,3,1234.50,66.7,2.5')
  assert.equal(lines[2], "'=SUM(A1),1,-5.00,,0.33", 'a cell that starts with = cannot run as a formula')
  assert.equal(lines[3], 'Total,4,1229.50,100,')
})

test('several tables in one file keep their headings', () => {
  const text = blocksCsv(bundle.blocks)
  assert.ok(text.startsWith('Sales by advisor\r\nAdvisor,'))
  assert.ok(text.includes('\r\nEmpty one\r\nAdvisor,'))
})

test('file names are safe and say which days they cover', () => {
  assert.equal(fileName('Sales by advisor', { from: '2026-10-01', to: '2026-10-14' }, 'csv'), 'sales-by-advisor-2026-10-01-to-2026-10-14.csv')
  assert.equal(fileName('Day', { from: '2026-10-14', to: '2026-10-14' }, 'iif'), 'day-2026-10-14.iif')
  assert.equal(fileName('../../etc/passwd', { from: '2026-10-01', to: '2026-10-02' }, 'csv'), 'etc-passwd-2026-10-01-to-2026-10-02.csv')
  assert.equal(fileName('***', { from: '2026-10-01', to: '2026-10-02' }, 'txt'), 'report-2026-10-01-to-2026-10-02.txt')
})

test('anything from the shop\'s own data is escaped on the print page and in the email', () => {
  for (const html of [printableHtml(bundle), emailHtml(bundle)]) {
    assert.ok(!html.includes('<script>alert(1)</script>'))
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(html.includes('Test Shop &lt;b&gt;'))
    assert.ok(html.includes('A &quot;note&quot; &amp; more'))
    assert.ok(html.includes('$1,234.50') && html.includes('Nothing here.') && html.includes('Total'))
    assert.ok(!/<script/i.test(html.replace(/&lt;script/g, '')), 'no script tag of its own')
    assert.ok(!/https?:\/\//.test(html), 'no remote images or links')
  }
  assert.ok(printableHtml(bundle).startsWith('<!doctype html>'))
  assert.ok(printableHtml(bundle).includes('@page'))
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
})

test('the plain text copy reads top to bottom', () => {
  const t = plainText(bundle)
  assert.ok(t.startsWith('Shop summary\nOct 1 to Oct 14, 2026\nFor Test Shop <b>'))
  assert.ok(t.includes('You collected $637 this month.'))
  assert.ok(t.includes('SALES BY ADVISOR'))
  assert.ok(t.includes('Dana  |  3  |  $1,234.50'))
  assert.ok(t.includes('Nothing here.'))
  assert.ok(!t.includes('\n\n\n'))
})
