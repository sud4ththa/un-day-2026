import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { friendlySendError, friendlyVerifyError } from '../lib/format.js'
import { otpConfig, whatsAppNotReady } from '../lib/otp.js'
import { routeHref } from '../lib/route.js'
import { supabase } from '../lib/supabase.js'

export function SignIn({ message, mode = 'lead' }) {
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(message || '')
  const [pending, setPending] = useState(false)
  const tried = useRef('')

  useEffect(() => {
    if (message) setError(message)
  }, [message])

  async function sendCode(event) {
    event.preventDefault()
    setError('')
    if (otpConfig.provider === 'whatsapp') {
      setError(whatsAppNotReady)
      return
    }
    setPending(true)
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: mode === 'parent'
        ? { shouldCreateUser: true, data: { purpose: 'parent' } }
        : { shouldCreateUser: true },
    })
    setPending(false)
    if (sendError) {
      setError(friendlySendError(sendError))
      return
    }
    setStep('code')
    setCode('')
    tried.current = ''
  }

  async function verify(token) {
    setError('')
    setPending(true)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    })
    setPending(false)
    if (verifyError) setError(friendlyVerifyError(verifyError))
  }

  useEffect(() => {
    if (step !== 'code' || code.length !== 6 || pending || code === tried.current) return
    tried.current = code
    void verify(code)
  }, [code, step, pending])

  return (
    <div className="wrap narrow">
      <Header
        title={mode === 'parent' ? 'Pledge' : 'Food list'}
        subtitle={mode === 'parent'
          ? 'Parents pledge food or money for a stall. Anyone with an email can sign in.'
          : 'Country leads send their stall plan here. The deadline is Tuesday 6 October 2026.'}
      />
      {step === 'email' ? (
        <form className="stack" onSubmit={sendCode}>
          <label className="field">
            <span className="label">Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a code'}
          </button>
          <p className="hint">
            {mode === 'parent'
              ? 'A 6-digit code arrives by email. It is not a link. Any parent email can sign in.'
              : 'A 6-digit code arrives by email. It is not a link. Only emails the PTC has added can sign in.'}
          </p>
          <p className="hint">
            {mode === 'parent'
              ? <a href={routeHref('/')}>Stall lead sign in</a>
              : <a href={routeHref('/pledge')}>Parent pledge</a>}
          </p>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            tried.current = code
            void verify(code.trim())
          }}
        >
          <label className="field">
            <span className="label">6-digit code</span>
            <input
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby="code-help"
            />
          </label>
          <p id="code-help" className="hint">Sent to {email.trim()}.</p>
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending || code.length !== 6}>
            {pending ? 'Checking…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setStep('email')
              setCode('')
              setError('')
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  )
}
