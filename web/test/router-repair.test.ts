// Verifies the repair-first routing: car problems / codes / diagrams / symptoms /
// follow-ups go to the manual; pricing and shop actions do not.
// Run:  node web/test/router-repair.test.ts
import { classifyRequest } from '../src/lib/ai/router.ts'

let pass = 0, fail = 0
function expectIntent(input: string, intent: string) {
  const got = classifyRequest(input).intent
  if (got === intent) { pass++; console.log(`  ok   - "${input}" -> ${got}`) }
  else { fail++; console.log(`  FAIL - "${input}" -> ${got} (wanted ${intent})`) }
}

// Repair / diagnostic / diagram / spec / code / symptom / follow-up -> manual
expectIntent('P0420', 'repair_lookup')
expectIntent('P0420 on my 2012 Accord', 'repair_lookup')
expectIntent('show me the wiring diagram', 'repair_lookup')
expectIntent('whats the firing order', 'repair_lookup')
expectIntent('show me the fuse box', 'repair_lookup')
expectIntent('it keeps misfiring', 'repair_lookup')
expectIntent('the engine is overheating', 'repair_lookup')
expectIntent('torque spec for the lug nuts', 'repair_lookup')
expectIntent('coolant capacity', 'repair_lookup')
expectIntent('how do I diagnose a rough idle', 'repair_lookup')
expectIntent('wiring diagram for the 2018 Wrangler', 'repair_lookup')
expectIntent('check engine light is on', 'repair_lookup')

// Pricing / parts -> NOT the manual
expectIntent('front brake price for a civic', 'parts_lookup')
expectIntent('how much to buy brake pads for a 2005 civic', 'parts_lookup')

// Shop / comms must not be hijacked by the broadened repair rule
expectIntent('remove the customer John', 'shop_ops')
expectIntent('send a text to John', 'communications')
expectIntent('what is the revenue this month', 'reports')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
