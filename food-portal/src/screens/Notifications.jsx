import { useEffect, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { friendlySaveError } from '../lib/format.js'
import {
  buildNotificationPreviews,
  notificationSettings,
  PROGRESS_SCHEDULES,
} from '../lib/notifications.js'
import { isDemo, supabase } from '../lib/supabase.js'

const TOGGLE_COPY = {
  parent_reminders: 'Parent reminders',
  daily_stall_update: 'Daily stall update',
  daily_admin_report: 'Daily report to the PTC',
  progress_report: 'Progress note',
}

export function Notifications({ profile, onBack }) {
  const [settings, setSettings] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [stallRes, dishRes, pledgeRes, parentRes, contactRes, adminRes, settingsRes] = await Promise.all([
      supabase.from('stalls').select('*').order('sort_order'),
      supabase.from('dishes').select('*'),
      supabase.from('pledges').select('*'),
      supabase.from('parents').select('*'),
      supabase.from('stall_contacts').select('*'),
      supabase.from('allowlist').select('*').eq('role', 'admin'),
      supabase.from('notification_settings').select('*').eq('id', 'portal').maybeSingle(),
    ])
    if (settingsRes.error) {
      setError('Notifications could not be loaded.')
      return
    }
    const next = notificationSettings(settingsRes.data)
    setSettings(next)
    setPreview(buildNotificationPreviews({
      stalls: stallRes.data || [],
      dishes: dishRes.data || [],
      pledges: pledgeRes.data || [],
      parents: parentRes.data || [],
      contacts: contactRes.data || [],
      admins: adminRes.data || [],
      settings: next,
    }))
  }

  useEffect(() => {
    void load()
  }, [])

  async function save(partial) {
    setError('')
    const { error: updateError } = await supabase.from('notification_settings').update(partial).eq('id', 'portal')
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    await load()
  }

  async function sendTest(kind) {
    setNotice('')
    setError('')
    if (isDemo) {
      setNotice('Demo: nothing is sent.')
      return
    }
    const url = import.meta.env.VITE_NOTIFY_URL
    if (!url) {
      setNotice('Email is not connected yet. The preview above is what would be sent.')
      return
    }
    setBusy(true)
    const { data } = await supabase.auth.getSession()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token || ''}`,
      },
      body: JSON.stringify({ mode: 'test', kind }),
    }).catch(() => null)
    setBusy(false)
    const payload = response ? await response.json().catch(() => ({})) : {}
    if (!response || payload.sent === false) {
      setNotice(payload.reason || 'Email is not connected yet. The preview above is what would be sent.')
      return
    }
    setNotice(`Test sent to ${profile.email}.`)
  }

  return (
    <div className="wrap">
      <Header title="Notifications" onBack={onBack} backLabel="All stalls" />
      <p className="hint">
        Every message stays off until you turn it on. Nothing is sent from the demo.
      </p>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!settings ? <p role="status">Loading…</p> : null}
      {settings && preview ? preview.messages.map((message) => (
        <section className="block" key={message.id}>
          <h2>{message.title}</h2>
          {message.id !== 'parent_morning' ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(settings[message.toggle])}
                onChange={(event) => save({ [message.toggle]: event.target.checked })}
              />
              {TOGGLE_COPY[message.toggle]}
            </label>
          ) : (
            <p className="hint">Uses the parent reminder switch above.</p>
          )}
          {message.id === 'progress_report' ? (
            <>
              <label className="field slim">
                <span className="label">When</span>
                <select
                  aria-label="Progress note schedule"
                  value={settings.progress_schedule}
                  onChange={(event) => save({ progress_schedule: event.target.value })}
                >
                  {PROGRESS_SCHEDULES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Recipients</span>
                <textarea
                  aria-label="Progress note recipients"
                  value={settings.progress_recipients}
                  placeholder="One email on each line"
                  onChange={(event) => setSettings({ ...settings, progress_recipients: event.target.value })}
                  onBlur={() => save({ progress_recipients: settings.progress_recipients })}
                />
                <span className="hint">Add Mrs Hannah Wells and the rest of the Parent Collective. No addresses are filled in for you.</span>
              </label>
            </>
          ) : null}
          {message.id === 'parent_eve' ? (
            <label className="field slim">
              <span className="label">Event date</span>
              <input
                type="date"
                aria-label="Event date"
                value={settings.event_date}
                onChange={(event) => save({ event_date: event.target.value })}
              />
              <span className="hint">Parents who pledged get a note the day before, and again that morning.</span>
            </label>
          ) : null}
          <p className="hint">To: {message.to}</p>
          <p><strong>{message.subject}</strong></p>
          <pre className="preview-mail">{message.body}</pre>
          <button type="button" className="btn" disabled={busy} onClick={() => sendTest(message.id)}>
            Send test to me
          </button>
        </section>
      )) : null}
    </div>
  )
}
