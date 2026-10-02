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

  if (!session) return <SignIn mode="parent" />

  const profile = {
    role: 'parent',
    email: (session.user.email || '').toLowerCase(),
    user_id: session.user.id,
    display_name: '',
    stall_id: null,
  }

  return <ParentPledge profile={profile} onSignOut={signOut} />
}

function LiveApp() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [gateMessage, setGateMessage] = useState('')
  const [stallId, setStallId] = useState(null)
  const [preview, setPreview] = useState(null)

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
        if (error || !data) {
          setGateMessage('This email is not on the list yet. Ask the PTC to add you.')
          setProfile(null)
          setStallId(null)
          setPreview(null)
          await supabase.auth.signOut()
          return
        }
        setGateMessage('')
        setProfile(data)
        setStallId((current) => (data.role === 'lead' || data.role === 'food_coordinator' ? data.stall_id : current))
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    setStallId(null)
    setPreview(null)
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

  if ((profile.role === 'lead' || profile.role === 'food_coordinator') && !profile.stall_id) {
    return (
      <div className="wrap narrow">
        <Header title="No stall yet" onSignOut={signOut} />
        <p>Your email is on the list, but the PTC has not assigned a stall yet.</p>
      </div>
    )
  }

  return (
    <Portal
      profile={profile}
      stallId={stallId}
      setStallId={setStallId}
      preview={preview}
      setPreview={setPreview}
      onSignOut={signOut}
    />
  )
}
