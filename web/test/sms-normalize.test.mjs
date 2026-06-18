// Runnable unit test for the phone-SMS inbound parsing and opt-out logic.
// Run: node web/test/sms-normalize.test.mjs
import { normalizeInbound, isOptOut } from '../src/lib/sms-normalize.ts'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass += 1
    console.log('  ok   -', name)
  } else {
    fail += 1
    console.log('  FAIL -', name)
  }
}

const tb = normalizeInbound({ sender: '+17135551234', message: 'is my car ready?', id: 'tb-1' })
check('textbee from', tb.from === '+17135551234')
check('textbee text', tb.text === 'is my car ready?')
check('textbee id', tb.messageId === 'tb-1')

const hs = normalizeInbound({ type: 'message.phone.received', data: { contact: '+17135559999', content: 'how much for brakes', id: 'hs-9' } })
check('httpsms from', hs.from === '+17135559999')
check('httpsms text', hs.text === 'how much for brakes')
check('httpsms id', hs.messageId === 'hs-9')

const cu = normalizeInbound({ from: '+12810001111', text: 'STOP' })
check('custom from', cu.from === '+12810001111')
check('custom text', cu.text === 'STOP')

const pl = normalizeInbound({ payload: { from: '+18329992222', body: 'thanks!' } })
check('payload from', pl.from === '+18329992222')
check('payload text', pl.text === 'thanks!')

const empty = normalizeInbound({ foo: 'bar' })
check('empty from blank', empty.from === '')
check('empty text blank', empty.text === '')

check('STOP', isOptOut('STOP') === true)
check('stop lowercase', isOptOut('stop') === true)
check('Unsubscribe trim', isOptOut('  Unsubscribe  ') === true)
check('STOP punctuation', isOptOut('STOP!') === true)
check('QUIT', isOptOut('QUIT') === true)
check('normal text not opt-out', isOptOut('how much for an oil change') === false)
check('STOP bugging me not opt-out', isOptOut('STOP bugging me') === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
