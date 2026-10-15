import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const testModule = { exports: {} }
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, URL }, { filename: relativePath })
  return testModule.exports
}

const { renderChatMarkdown, chatPlainText, escapeHtml, safeUrl } = load('../src/components/ai-desk/markdown.ts')

test('chat answers never carry markup of their own', () => {
  const html = renderChatMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
  assert.doesNotMatch(html, /<script|<img src=x/)
  assert.match(html, /&lt;script&gt;/)
  assert.equal(escapeHtml(`"a" & 'b'`), '&quot;a&quot; &amp; &#39;b&#39;')
})

test('only http and https links are clickable', () => {
  assert.match(renderChatMarkdown('[bad](javascript:alert(1))'), /href="#"/)
  assert.match(renderChatMarkdown('[ok](https://example.com/a?b=1&c=2)'), /href="https:\/\/example.com\/a\?b=1&amp;c=2"/)
  assert.equal(safeUrl('data:text/html,hi'), '#')
})

test('link text with an ampersand is shown once-escaped, not double-escaped', () => {
  const html = renderChatMarkdown('[R&R Plumbing](https://example.com)')
  assert.match(html, />R&amp;R Plumbing<\/a>/)
  assert.doesNotMatch(html, /&amp;amp;/)
})

test('fenced code keeps its lines and nothing inside it is formatted', () => {
  const html = renderChatMarkdown('Run this:\n```\nP0300 **random**\n  cyl 3 | 41\n```\nDone.')
  assert.match(html, /<pre[^>]*><code>P0300 \*\*random\*\*\n  cyl 3 \| 41<\/code><\/pre>/)
  assert.match(html, /<p[^>]*>Done\.<\/p>/)
})

test('an unclosed code fence runs to the end instead of swallowing the page', () => {
  const html = renderChatMarkdown('```\nline one\nline two')
  assert.match(html, /<pre[^>]*><code>line one\nline two<\/code><\/pre>/)
})

test('italics need stars that hug the words, so maths stays maths', () => {
  assert.match(renderChatMarkdown('*Note:* check it'), /<em>Note:<\/em>/)
  assert.doesNotMatch(renderChatMarkdown('5 * 3 * 2 = 30'), /<em>/)
  assert.doesNotMatch(renderChatMarkdown('2*3*4'), /<em>/)
})

test('tables scroll inside their own box and keep their natural width', () => {
  const html = renderChatMarkdown('| Check | Cost |\n| --- | --- |\n| Plugs | $64.00 |')
  assert.match(html, /overflow-x-auto[^"]*"><table class="w-max min-w-full/)
  assert.match(html, /<th[^>]*>Check<\/th>/)
  assert.match(html, /<td[^>]*>\$64\.00<\/td>/)
})

test('lists, quotes and rules render as blocks', () => {
  const html = renderChatMarkdown('1. First\n2. Second\n\n- one\n- two\n\n> careful\n\n---')
  assert.match(html, /<ol[^>]*><li[^>]*>First<\/li><li[^>]*>Second<\/li><\/ol>/)
  assert.match(html, /<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/)
  assert.match(html, /<blockquote[^>]*>careful<\/blockquote>/)
  assert.match(html, /<hr /)
})

test('copied answers are plain text a customer could read', () => {
  const text = chatPlainText('### Brakes\n**Marcus Bell** owes $412.50. See [the estimate](https://example.com/e/1).\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- front pads\n- `rotors`')
  assert.equal(text.includes('**'), false)
  assert.equal(text.includes('###'), false)
  assert.match(text, /Marcus Bell owes \$412\.50\. See the estimate \(https:\/\/example\.com\/e\/1\)\./)
  assert.match(text, /1 \| 2/)
  assert.doesNotMatch(text, /---/)
  assert.match(text, /- front pads\n- rotors/)
})

test('Ask Alpha can be stopped, keeps drafts, and locks double sends', () => {
  const page = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')
  // Stop button wired to one controller per turn, and passed to the workflow request.
  assert.match(page, /aria-label=\{stopping \? 'Stopping' : 'Stop'\}/)
  assert.match(page, /body: JSON\.stringify\(request\), signal: runSignal\(\)/)
  assert.match(page, /const STOP_NOTICE = 'Stopped by you\. Nothing was sent or changed\.'/)
  // A half-typed message survives a refresh.
  assert.match(page, /localStorage\.setItem\('alpha_ask_draft', input\)/)
  // Every send button on a saved-document card locks while one is sending.
  assert.match(page, /sendButtons\.forEach\(button => \{ button\.disabled = true \}\)/)
  // No window.prompt for edits, and the phone Enter key makes a new line.
  assert.doesNotMatch(page, /window\.prompt/)
  assert.match(page, /\(pointer: coarse\)/)
})
