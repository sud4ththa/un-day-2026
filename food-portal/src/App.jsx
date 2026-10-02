import { useEffect, useState } from 'react'
import { DemoApp } from './DemoApp.jsx'
import { Header } from './components/Header.jsx'
import { routePath } from './lib/route.js'
import { configError, isDemo, supabase } from './lib/supabase.js'
import { Portal } from './Portal.jsx'
import { ParentPledge } from './screens/ParentPledge.jsx'
import { SignIn } from './screens/SignIn.jsx'

export default function App() {
  if (isDemo) return <DemoApp initialActor={routePath() === '/pledge' ? 'parent' : 'admin'} />
  if (routePath() === '/pledge') return <ParentApp />
  return <LiveApp />
}

function ParentApp() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!supabase) return undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
  }

  if (configError) {
    return (
      <div className="wrap narrow">
        <Header title="Pledge" />
        <p className="banner" role="alert">{configError}</p>
      </div>
    )
  }

  if (session === undefined) {
    return (
      <div className="wrap narrow">
        <Header title="Pledge" />
        <p role="status">Loading…</p>
      </div>
    )
  }

  const profile = session
    ? {
      role: 'parent',
      email: (session.user.email || '').toLowerCase(),
      user_id: session.user.id,
      display_name: '',
      stall_id: null,
    }
    : null

  return <ParentPledge profile={profile} onSignOut={signOut} />
}

function LiveApp() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [gateMessage, setGateMessage] = useState('')
  const [stallId, setStallId] = useState(null)

  useEffect(() => {
    if (!supabase) return undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || session === undefined) return undefined
    if (!session) {
      setProfile(null)
      return undefined
    }
    let cancelled = false
    const email = (session.user.email || '').toLowerCase()
    supabase
      .from('allowlist')
      .select('*')
      .eq('email', email)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error || !data || data.role !== 'admin') {
          setGateMessage('This email is not a PTC admin. Stall leads do not sign in here.')
          setProfile(null)
          setStallId(null)
          await supabase.auth.signOut()
          return
        }
        setGateMessage('')
        setProfile(data)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    setStallId(null)
  }

  if (configError) {
    return (
      <div className="wrap narrow">
        <Header title="Food list" />
        <p className="banner" role="alert">{configError}</p>
      </div>
    )
  }

  const sessionEmail = session?.user?.email?.toLowerCase() || ''
  const profileReady = !session || (profile && profile.email === sessionEmail)

  if (session === undefined || (session && !profileReady)) {
    return (
      <div className="wrap narrow">
        <Header title="Food list" />
        <p role="status">Loading…</p>
      </div>
    )
  }

  if (!session || !profile) return <SignIn message={gateMessage} />

  return (
    <Portal
      profile={profile}
      stallId={stallId}
      setStallId={setStallId}
      onSignOut={signOut}
    />
  )
}
