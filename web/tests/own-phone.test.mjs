import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadLib } from './estimates-helper.mjs'

const own = loadLib('own-phone')
const send = loadLib('doc-send')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

test('own phone: the device is told apart, and an iPad that calls itself a Mac counts as an iPhone-type device', () => {
  assert.equal(own.platformOf(IPHONE, 5), 'ios')
  assert.equal(own.platformOf(ANDROID, 5), 'android')
  assert.equal(own.platformOf(MAC, 0), 'mac')
  assert.equal(own.platformOf(MAC, 5), 'ios')
  assert.equal(own.platformOf(WINDOWS, 0), 'other')
  assert.equal(own.platformOf('', 0), 'other')
  assert.equal(own.canOpenMessages('ios'), true)
  assert.equal(own.canOpenMessages('android'), true)
  assert.equal(own.canOpenMessages('mac'), true)
  assert.equal(own.canOpenMessages('other'), false)
})

test('own phone: a number is made full or refused, never guessed', () => {
  assert.equal(own.dialNumber('(713) 555-0142'), '+17135550142')
  assert.equal(own.dialNumber('713.555.0142'), '+17135550142')
  assert.equal(own.dialNumber('1-713-555-0142'), '+17135550142')
  assert.equal(own.dialNumber('+1 713 555 0142'), '+17135550142')
  assert.equal(own.dialNumber('+44 20 7946 0958'), '+442079460958')
  assert.equal(own.dialNumber('555-0142'), '')
  assert.equal(own.dialNumber('Marcus Bell'), '')
  assert.equal(own.dialNumber(''), '')
  assert.equal(own.dialNumber(null), '')
  assert.equal(own.dialNumber('+123'), '')
})

test('own phone: the link joins the words with & on iPhone and Mac and with ? on Android, and the words are safely encoded', () => {
  const body = 'Hi Dana, your Honda is ready.\nTotal $120 & change #1 100% "ok" é'
  const ios = own.smsHref('(713) 555-0142', body, 'ios')
  assert.ok(ios.startsWith('sms:+17135550142&body='))
  assert.equal(decodeURIComponent(ios.slice('sms:+17135550142&body='.length)), body)
  assert.ok(own.smsHref('713-555-0142', body, 'mac').startsWith('sms:+17135550142&body='))
  const android = own.smsHref('713-555-0142', body, 'android')
  assert.ok(android.startsWith('sms:+17135550142?body='))
  assert.equal(decodeURIComponent(android.slice('sms:+17135550142?body='.length)), body)
  // Nothing in the words can break out of the link.
  assert.doesNotMatch(ios.slice('sms:+17135550142&body='.length), /[\s&#"]/)
})

test('own phone: no number gives no link, no words gives a link to just the number, and a very long text is cut', () => {
  assert.equal(own.smsHref('', 'hello', 'ios'), '')
  assert.equal(own.smsHref('Marcus', 'hello', 'ios'), '')
  assert.equal(own.smsHref('713-555-0142', '   ', 'ios'), 'sms:+17135550142')
  const long = own.smsHref('713-555-0142', 'a'.repeat(5000), 'ios')
  assert.equal(decodeURIComponent(long.slice('sms:+17135550142&body='.length)).length, own.BODY_MAX)
})

test('own phone: the notes never claim that Alpha sent anything or can see the phone', () => {
  assert.match(own.OWN_PHONE_NOTE, /your own phone number, not the shop number/)
  assert.match(own.OWN_PHONE_NOTE, /replies come to your phone, not to the Inbox/)
  assert.match(own.OWN_PHONE_NOTE, /Alpha does not send it and cannot see whether you did/)
})

test('send: a text from the owner\'s own phone needs no texting account but still honors "asked not to get texts"', () => {
  const base = { channel: 'phone', status: 'Draft', email: '', phone: '713-555-0101', emailReady: false, smsReady: false, optedOut: false }
  assert.equal(send.isSendChannel('phone'), true)
  assert.equal(send.sendBlockReason(base), '')
  assert.match(send.sendBlockReason({ ...base, phone: '' }), /no phone number/i)
  assert.match(send.sendBlockReason({ ...base, optedOut: true }), /asked not to get texts/)
  assert.match(send.sendBlockReason({ ...base, status: 'Void' }), /void/)
  // The same shop, same customer, through Alpha's own texting is still refused when texting is not set up.
  assert.match(send.sendBlockReason({ ...base, channel: 'sms' }), /not set up/)
})

test('screens: the own-phone option is on the send sheet, the new-message sheet and the job text, and the send sheet marks nothing sent until the owner says so', () => {
  const sheet = read('components/documents/SendSheet.tsx')
  // Preparing the text does not tell the page it was sent.
  const prepare = sheet.slice(sheet.indexOf("if (channel === 'phone') {"), sheet.indexOf('const result: SentResult'))
  assert.ok(prepare.length > 150)
  assert.doesNotMatch(prepare, /onSent\(/)
  assert.match(prepare, /setPhoneReady\(/)
  // Only the "I sent it" button reports a send.
  const confirm = sheet.slice(sheet.indexOf('const confirmSent = async'), sheet.indexOf('const copy = async'))
  assert.match(confirm, /confirmPhoneSent\(/)
  assert.match(confirm, /onSent\(\{ channel: 'phone'/)
  assert.match(sheet, /I sent it/)
  assert.match(sheet, /Close, I have not sent it/)
  assert.match(sheet, /the \{noun\} stays unsent in Alpha/)
  assert.match(read('components/inbox/NewMessageSheet.tsx'), /channel === 'sms' && <PhoneTextActions phone=\{to\} body=\{body\} \/>/)
  assert.match(read('components/jobs/JobDetail.tsx'), /<PhoneTextActions phone=\{phone\} body=\{body\} \/>/)
  const actions = read('components/PhoneTextActions.tsx')
  assert.match(actions, /Open in Messages/)
  assert.match(actions, /Copy the text/)
  // Nothing is guessed on the server about which device this is.
  assert.match(actions, /useEffect\(\(\) => \{\s*try \{ setPlatform\(platformOf\(navigator\.userAgent/)
})

test('the From my phone button asks the server whether the number said STOP, and refuses when it did', () => {
  const button = read('components/PhoneTextActions.tsx')
  assert.match(button, /\/api\/sms-consent/)
  assert.match(button, /stopped === true/)
  assert.match(button, /replied STOP/)
  // The number goes in the request body, never in the address.
  assert.doesNotMatch(button, /sms-consent\?/)
  const route = read('app/api/sms-consent/route.ts')
  assert.match(route, /export async function POST/)
  assert.match(route, /getAuthedShop/)
  assert.match(route, /isSmsOptedOut\(db, auth\.shopId/)
  assert.match(route, /eq\('shop_id', auth\.shopId\)/)
})

test('a customer\'s Text screen offers From my phone too', () => {
  assert.match(read('components/customers/SendPanel.tsx'), /<PhoneTextActions phone=\{to\} body=\{body\} \/>/)
})
