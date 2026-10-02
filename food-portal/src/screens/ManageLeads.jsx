import { useEffect, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { friendlySaveError } from '../lib/format.js'
import { ASSIGNED_YEAR_GROUPS } from '../lib/yearGroups.js'
import { supabase } from '../lib/supabase.js'

const EMPTY = { display_name: '', email: '', phone: '', stall_id: '' }

export function ManageLeads({ onBack }) {
  const [stalls, setStalls] = useState(null)
  const [people, setPeople] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removeId, setRemoveId] = useState(null)

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
    setForm((current) => ({ ...current, stall_id: current.stall_id || stallRes.data?.[0]?.id || '' }))
    const nextDrafts = {}
    for (const person of peopleRes.data || []) {
      if (person.role !== 'lead') continue
      nextDrafts[person.id] = {
        display_name: person.display_name || '',
        email: person.email || '',
        phone: person.phone || '',
        stall_id: person.stall_id || '',
      }
    }
    setDrafts(nextDrafts)
  }

  useEffect(() => {
    void load()
  }, [])

  const leads = people.filter((person) => person.role === 'lead')

  async function addLead(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    const { error: insertError } = await supabase.from('allowlist').insert({
      display_name: form.display_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: 'lead',
      stall_id: form.stall_id,
    })
    if (insertError) {
      setError(friendlySaveError(insertError))
      return
    }
    setForm((current) => ({ ...EMPTY, stall_id: current.stall_id }))
    setNotice('Added. They can sign in with an email code.')
    await load()
  }

  async function saveLead(person) {
    setError('')
    setNotice('')
    const draft = drafts[person.id]
    if (!draft?.stall_id) {
      setError('Choose a stall for this lead.')
      return
    }
    const { error: updateError } = await supabase.from('allowlist').update({
      display_name: draft.display_name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      role: 'lead',
      stall_id: draft.stall_id,
    }).eq('id', person.id)
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    setNotice('Saved.')
    await load()
  }

  async function removeLead(person) {
    setError('')
    setNotice('')
    const { error: deleteError } = await supabase.from('allowlist').delete().eq('id', person.id)
    if (deleteError) {
      setError(friendlySaveError(deleteError))
      return
    }
    setRemoveId(null)
    setNotice('Removed. That email can no longer sign in.')
    await load()
  }

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

  function patchDraft(id, partial) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...partial } }))
  }

  return (
    <div className="wrap wide">
      <Header title="Manage leads" onBack={onBack} backLabel="All stalls" />
      <p className="hint">
        Adding a lead puts their email on the sign-in list. Removing them takes it off. A stall can have more than one lead.
      </p>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!stalls ? <p role="status">Loading…</p> : null}
      {stalls ? (
        <>
          <form className="people-form" onSubmit={addLead}>
            <label className="field">
              <span className="label">Name</span>
              <input
                value={form.display_name}
                onChange={(event) => setForm({ ...form, display_name: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span className="label">Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Phone</span>
              <input
                inputMode="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Stall</span>
              <select
                required
                value={form.stall_id}
                onChange={(event) => setForm({ ...form, stall_id: event.target.value })}
              >
                {stalls.map((stall) => (
                  <option key={stall.id} value={stall.id}>{stall.name}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" type="submit">Add lead</button>
          </form>

          {stalls.map((stall) => {
            const stallLeads = leads.filter((person) => person.stall_id === stall.id)
            return (
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
                {stallLeads.length === 0 ? <p className="hint">No lead yet.</p> : null}
                <ul className="people">
                  {stallLeads.map((person) => {
                    const draft = drafts[person.id] || EMPTY
                    return (
                      <li key={person.id}>
                        <label className="field">
                          <span className="label">Name</span>
                          <input
                            value={draft.display_name}
                            onChange={(event) => patchDraft(person.id, { display_name: event.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span className="label">Email</span>
                          <input
                            type="email"
                            value={draft.email}
                            onChange={(event) => patchDraft(person.id, { email: event.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span className="label">Phone</span>
                          <input
                            inputMode="tel"
                            value={draft.phone}
                            onChange={(event) => patchDraft(person.id, { phone: event.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span className="label">Stall</span>
                          <select
                            aria-label={`Stall for ${person.email}`}
                            value={draft.stall_id}
                            onChange={(event) => patchDraft(person.id, { stall_id: event.target.value })}
                          >
                            {stalls.map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="btn" onClick={() => saveLead(person)}>Save</button>
                        {removeId === person.id ? (
                          <span className="inline-actions">
                            <button type="button" className="btn btn-quiet" onClick={() => removeLead(person)}>Remove</button>
                            <button type="button" className="btn btn-quiet" onClick={() => setRemoveId(null)}>Keep</button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-quiet" onClick={() => setRemoveId(person.id)}>Remove</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
