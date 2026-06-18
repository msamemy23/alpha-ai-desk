// SMS helper — kept for backward compatibility.
// The implementation now lives in lib/sms.ts and is provider-agnostic
// (Telnyx OR the shop's own phone via TextBee/httpSMS/custom gateway),
// selected by the SMS_PROVIDER env var. All existing callers that import
// { sendSMS, formatPhone } from '@/lib/telnyx' keep working unchanged.
export { sendSMS, formatPhone } from './sms'
