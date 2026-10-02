import { useEffect, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { friendlySaveError } from '../lib/format.js'
import { ASSIGNED_YEAR_GROUPS } from '../lib/yearGroups.js'
import { supabase } from '../lib/supabase.js'

const SLOTS = [
  ['lead', 'Lead'],
  ['food_coordinator', 'Food coordinator'],
]

export function ManageLeads({ onBack }) {
  const [stalls, setStalls] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const [stallRes, peopleRes] = await Promise.all([
      supabase.from('stalls').select('id, name, sort_order, assigned_year_group').order('sort_order'),
      supabase.from('allowlist').select('*').order('email'),
    ])
    if (stallRes.error || peopleRes.error) {
      setError('The lead list could not be loaded.')
      return
    }
    setStalls(stallRes.data || [])
    setPeople(peopleRes.data || [])
  }

  useEffect(() => {
    void load()
  }, [])

  async function setYearGroup(stall, value) {
    setError('')
    const { error: updateError } = await supabase
      .from('stalls')
      .update({ assigned_year_group: value || null })
      .eq('id', stall.id)
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    await load()
  }

  return (
    <div className="wrap wide">
      <Header title="Manage leads" onBack={onBack} backLabel="All stalls" />
      <p className="hint">
        Each stall has one lead. A food coordinator is optional. Both can sign in with an email code and open that stall’s food list and pledges.
      </p>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!stalls ? <p role="status">Loading…</p> : null}
      {stalls?.map((stall) => (
        <section className="block" key={stall.id}>
          <h2>{stall.name}</h2>
          <label className="field slim">
            <span className="label">Year group</span>
            <select
              aria-label={`Year group for ${stall.name}`}
              value={stall.assigned_year_group || ''}
              onChange={(event) => setYearGroup(stall, event.target.value)}
            >
              <option value="">Not set</option>
              {ASSIGNED_YEAR_GROUPS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          {SLOTS.map(([role, label]) => (
            <Slot
              key={`${stall.id}:${role}`}
              stall={stall}
              role={role}
              label={label}
              person={people.find((item) => item.role === role && item.stall_id === stall.id) || null}
              onError={setError}
              onDone={async (message) => {
                setNotice(message)
                await load()
              }}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function Slot({ stall, role, label, person, onError, onDone }) {
  const [form, setForm] = useState({
    display_name: person?.display_name || '',
    email: person?.email || '',
    phone: person?.phone || '',
  })
  const [confirm, setConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    setForm({
      display_name: person?.display_name || '',
      email: person?.email || '',
      phone: person?.phone || '',
    })
    setConfirm(false)
    setRemoving(false)
  }, [person?.id, person?.email, person?.display_name, person?.phone])

  const email = form.email.trim().toLowerCase()
  const replacing = Boolean(person && email && email !== person.email)

  async function save(event) {
    event.preventDefault()
    onError('')
    if (!form.display_name.trim() || !email) return
    if (replacing && !confirm) {
      setConfirm(true)
      return
    }
    const payload = {
      display_name: form.display_name.trim(),
      email,
      phone: form.phone.trim(),
      role,
      stall_id: stall.id,
    }
    const result = person
      ? await supabase.from('allowlist').update(payload).eq('id', person.id)
      : await supabase.from('allowlist').insert(payload)
    if (result.error) {
      onError(friendlySaveError(result.error))
      return
    }
    setConfirm(false)
    const verb = person ? (replacing ? 'Replaced' : 'Saved') : 'Added'
    await onDone(`${verb}. They can sign in with an email code.`)
  }

  async function remove() {
    onError('')
    const { error } = await supabase.from('allowlist').delete().eq('id', person.id)
    if (error) {
      onError(friendlySaveError(error))
      return
    }
    setRemoving(false)
    await onDone('Removed. That email can no longer sign in.')
  }

  return (
    <form className="slot" onSubmit={save}>
      <h3>{label}</h3>
      <div className="people-form">
        <label className="field">
          <span className="label">Name</span>
          <input
            aria-label={`${label} name for ${stall.name}`}
            value={form.display_name}
            onChange={(event) => { setConfirm(false); setForm({ ...form, display_name: event.target.value }) }}
            required
          />
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input
            type="email"
            aria-label={`${label} email for ${stall.name}`}
            value={form.email}
            onChange={(event) => { setConfirm(false); setForm({ ...form, email: event.target.value }) }}
            required
          />
        </label>
        <label className="field">
          <span className="label">Phone</span>
          <input
            inputMode="tel"
            aria-label={`${label} phone for ${stall.name}`}
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </label>
        <button className="btn btn-primary" type="submit">
          {person ? (replacing ? 'Replace' : 'Save') : `Add ${label.toLowerCase()}`}
        </button>
        {person && !removing ? (
          <button className="btn btn-quiet" type="button" onClick={() => setRemoving(true)}>Remove</button>
        ) : null}
        {person && removing ? (
          <>
            <button className="btn btn-quiet" type="button" onClick={remove}>Remove</button>
            <button className="btn btn-quiet" type="button" onClick={() => setRemoving(false)}>Keep</button>
          </>
        ) : null}
      </div>
      {confirm && person ? (
        <p className="banner" role="status">
          Replace {person.display_name || person.email} with {form.display_name.trim() || email}? {person.display_name || person.email} will no longer be able to sign in.
          <span className="inline-actions">
            <button className="btn btn-primary" type="submit">Replace</button>
            <button className="btn btn-quiet" type="button" onClick={() => setConfirm(false)}>Cancel</button>
          </span>
        </p>
      ) : null}
    </form>
  )
}
