import { useEffect, useState } from 'react'
import { Header } from './components/Header.jsx'
import { configError, supabase } from './lib/supabase.js'
import { AdminDashboard } from './screens/AdminDashboard.jsx'
import { PlanEditor } from './screens/PlanEditor.jsx'
import { SignIn } from './screens/SignIn.jsx'

export default function App() {
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
        if (error || !data) {
          setGateMessage('This email is not on the list yet. Ask the PTC to add you.')
          setProfile(null)
          setStallId(null)
          await supabase.auth.signOut()
          return
        }
        setGateMessage('')
        setProfile(data)
        setStallId((current) => (data.role === 'lead' ? data.stall_id : current))
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

  if (profile.role === 'lead' && !profile.stall_id) {
    return (
      <div className="wrap narrow">
        <Header title="No stall yet" onSignOut={signOut} />
        <p>Your email is on the list, but the PTC has not assigned a stall yet.</p>
      </div>
    )
  }

  if (profile.role === 'admin' && !stallId) {
    return (
      <AdminDashboard
        profile={profile}
        onOpen={setStallId}
        onSignOut={signOut}
      />
    )
  }

  return (
    <PlanEditor
      profile={profile}
      stallId={stallId}
      onBack={profile.role === 'admin' ? () => setStallId(null) : null}
      onSignOut={signOut}
    />
  )
}
