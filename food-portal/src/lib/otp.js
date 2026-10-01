// Email is the only sign-in that sends a code.
// WhatsApp via Twilio is not wired up. VITE_OTP_PROVIDER=whatsapp is a switch
// for later; it does not call Twilio.

const requested = import.meta.env.VITE_OTP_PROVIDER || 'email'

export const otpConfig = {
  provider: requested === 'whatsapp' ? 'whatsapp' : 'email',
}

export const whatsAppNotReady =
  'WhatsApp codes are not switched on yet. Ask the PTC to send an email code instead.'

// Phone numbers are stored for the stall lead and are not checked.
// VITE_PHONE_AUTH=twilio-verify is the switch for Supabase phone auth
// plus Twilio Verify later. It does not call Twilio.
const phoneRequested = import.meta.env.VITE_PHONE_AUTH || 'off'

export const phoneAuth = {
  provider: phoneRequested === 'twilio-verify' ? 'twilio-verify' : 'off',
}

export const phoneStoredNote = phoneAuth.provider === 'twilio-verify'
  ? 'Phone verification is not connected yet. Your number is stored for the stall lead.'
  : 'Your number is stored for the stall lead. It is not verified.'
