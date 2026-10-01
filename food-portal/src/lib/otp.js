// Email is the only sign-in that sends a code.
// WhatsApp via Twilio is not wired up. VITE_OTP_PROVIDER=whatsapp is a switch
// for later; it does not call Twilio.

const requested = import.meta.env.VITE_OTP_PROVIDER || 'email'

export const otpConfig = {
  provider: requested === 'whatsapp' ? 'whatsapp' : 'email',
}

export const whatsAppNotReady =
  'WhatsApp codes are not switched on yet. Ask the PTC to send an email code instead.'
