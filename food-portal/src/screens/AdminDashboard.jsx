import { useEffect, useMemo, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { download, toCsv, toJson } from '../lib/export.js'
import { BANK_APPROVAL_NOTE } from '../lib/bankDetails.js'
import { formatWhen, friendlySaveError } from '../lib/format.js'
import { STATUS_LABEL } from '../lib/plan.js'
import { clusterDuplicates } from '../lib/similarity.js'
import { supabase } from '../lib/supabase.js'

function personName(email, people) {
  if (!email) return ''
  const person = people.find((item) => item.email === email.toLowerCase())
  return person?.display_name || email
}

export function AdminDashboard({ profile, onOpen, onViewAsLead, onSignOut }) {
  const [stalls, setStalls] = useState(null)
  const [dishes, setDishes] = useState([])
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lockId, setLockId] = useState(null)
  const [removeId, setRemoveId] = useState(null)
  const [allowBank, setAllowBank] = useState(false)
  const [bankBusy, setBankBusy] = useState(false)
  const [form, setForm] = useState({
    email: '',
    display_name: '',
    role: 'lead',
    stall_id: '',
  })

  async function load() {
    setError('')
    const [stallRes, dishRes, peopleRes, settingsRes] = await Promise.all([
      supabase.from('stalls').select('*').order('sort_order'),
      supabase.from('dishes').select('*').order('sort_order'),
      supabase.from('allowlist').select('*').order('email'),
      supabase.from('portal_settings').select('allow_bank_details').eq('id', 'portal').maybeSingle(),
    ])
    if (stallRes.error || dishRes.error || peopleRes.error || settingsRes.error) {
      setError('The stalls could not be loaded.')
      return
    }
    setStalls(stallRes.data)
    setDishes(dishRes.data)
    setPeople(peopleRes.data)
    setAllowBank(Boolean(settingsRes.data?.allow_bank_details))
    if (!form.stall_id && stallRes.data[0]) {
      setForm((current) => ({ ...current, stall_id: current.stall_id || stallRes.data[0].id }))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const counts = useMemo(() => {
    const tally = { not_started: 0, draft: 0, submitted: 0, locked: 0 }
    for (const stall of stalls || []) tally[stall.status] = (tally[stall.status] || 0) + 1
    return tally
  }, [stalls])

  const clusters = useMemo(() => {
    if (!stalls) return []
    const names = new Map(stalls.map((stall) => [stall.id, stall.name]))
    return clusterDuplicates(
      dishes
        .filter((dish) => dish.name.trim())
        .map((dish) => ({
          stall_id: dish.stall_id,
          stall_name: names.get(dish.stall_id) || dish.stall_id,
          dish_name: dish.name,
        })),
    )
  }, [stalls, dishes])

  async function toggleBank(next) {
    setBankBusy(true)
    setError('')
    const { error: updateError } = await supabase
      .from('portal_settings')
      .update({ allow_bank_details: next })
      .eq('id', 'portal')
    setBankBusy(false)
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    setAllowBank(next)
  }

  async function setLocked(stall, locked) {
    const status = locked
      ? 'locked'
      : stall.submitted_at
        ? 'submitted'
        : stall.updated_by_email
          ? 'draft'
          : 'not_started'
    const { error: updateError } = await supabase.from('stalls').update({ status }).eq('id', stall.id)
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    setLockId(null)
    await load()
  }

  async function addPerson(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    const { error: insertError } = await supabase.from('allowlist').insert({
      email: form.email.trim(),
      display_name: form.display_name.trim(),
      role: form.role,
      stall_id: form.role === 'lead' ? form.stall_id : null,
    })
    if (insertError) {
      setError(friendlySaveError(insertError))
      return
    }
    setForm((current) => ({ ...current, email: '', display_name: '' }))
    setNotice('Added.')
    await load()
  }

  async function updatePerson(person, partial) {
    setError('')
    const next = { ...partial }
    if (next.role === 'admin') next.stall_id = null
    if (next.role === 'lead' && !next.stall_id && !person.stall_id) {
      setError('Choose a stall for this lead.')
      return
    }
    const { error: updateError } = await supabase.from('allowlist').update(next).eq('id', person.id)
    if (updateError) {
      setError(friendlySaveError(updateError))
      return
    }
    await load()
  }

  async function removePerson(person) {
    setError('')
    const { error: deleteError } = await supabase.from('allowlist').delete().eq('id', person.id)
    if (deleteError) {
      setError(friendlySaveError(deleteError))
      return
    }
    setRemoveId(null)
    await load()
  }

  const orderedPeople = [...people].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
    const order = new Map((stalls || []).map((stall) => [stall.id, stall.sort_order]))
    return (order.get(a.stall_id) || 99) - (order.get(b.stall_id) || 99)
  })

  return (
    <div className="wrap wide">
      <Header
        title="All stalls"
        subtitle={`Signed in as ${profile.display_name || profile.email}`}
        onSignOut={onSignOut}
      >
        <div className="inline-actions">
          <button
            type="button"
            className="btn"
            disabled={!stalls}
            onClick={() => download('un-day-2026-food-plans.csv', toCsv(stalls, dishes), 'text/csv;charset=utf-8')}
          >
            Download CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={!stalls}
            onClick={() => download(
              'un-day-2026-food-plans.json',
              JSON.stringify(toJson(stalls, dishes), null, 2),
              'application/json',
            )}
          >
            Download JSON
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => load()}>
            Refresh
          </button>
        </div>
      </Header>

      {error ? <p className="banner" role="alert">{error}</p> : null}
      {!stalls ? <p role="status">Loading stalls…</p> : null}

      {stalls ? (
        <>
          <p className="balance">
            {counts.not_started} not started · {counts.draft} draft · {counts.submitted} submitted · {counts.locked} locked
          </p>
          <nav className="jump">
            <a href="#stalls">Stalls</a>
            <a href="#duplicates">Duplicates</a>
            <a href="#people">Who can sign in</a>
          </nav>

          <section className="block" id="bank-details">
            <h2>Bank details</h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={allowBank}
                disabled={bankBusy}
                onChange={(event) => toggleBank(event.target.checked)}
              />
              Allow bank details
            </label>
            <p className="hint">
              {allowBank
                ? 'Leads can enter an account name, bank, branch, account number, and the reference parents should use.'
                : BANK_APPROVAL_NOTE}
            </p>
          </section>

          <section className="block" id="stalls">
            <h2>Stalls</h2>
            <ol className="register">
              {stalls.map((stall) => {
                const leads = people.filter((person) => person.role === 'lead' && person.stall_id === stall.id)
                const dishCount = dishes.filter((dish) => dish.stall_id === stall.id && dish.name.trim()).length
                const who = personName(stall.updated_by_email, people)
                return (
                  <li key={stall.id}>
                    <div>
                      <h3>
                        {stall.name}{' '}
                        <span className={`pill pill-${stall.status}`}>{STATUS_LABEL[stall.status]}</span>
                      </h3>
                      <p>
                        {stall.year_groups || 'Year group not set'}
                        {' · '}
                        {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}
                        {' · '}
                        {leads.length ? leads.map((lead) => lead.display_name || lead.email).join(', ') : 'No lead yet'}
                      </p>
                      <p className="hint">
                        {who ? `Last saved ${formatWhen(stall.updated_at)} by ${who}` : 'Not saved yet'}
                      </p>
                    </div>
                    <div className="inline-actions">
                      <button type="button" className="btn" onClick={() => onOpen(stall.id)}>
                        Open
                      </button>
                      <button type="button" className="btn" onClick={() => onViewAsLead(stall.id)}>
                        View as lead
                      </button>
                      {lockId === stall.id ? (
                        <>
                          <button type="button" className="btn btn-primary" onClick={() => setLocked(stall, stall.status !== 'locked')}>
                            {stall.status === 'locked' ? 'Unlock' : 'Lock'}
                          </button>
                          <button type="button" className="btn btn-quiet" onClick={() => setLockId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-quiet" onClick={() => setLockId(stall.id)}>
                          {stall.status === 'locked' ? 'Unlock' : 'Lock'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          <section className="block" id="duplicates">
            <h2>Dishes on more than one stall</h2>
            {clusters.length === 0 ? <p className="hint">No overlapping dishes right now.</p> : null}
            <ul className="clusters">
              {clusters.map((cluster) => {
                const title = cluster.members.slice().sort((a, b) => a.dish_name.length - b.dish_name.length)[0].dish_name
                return (
                  <li key={cluster.members.map((member) => `${member.stall_id}:${member.dish_name}`).join('|')}>
                    <strong>{title}</strong>
                    <ul>
                      {cluster.members.map((member) => (
                        <li key={`${member.stall_id}:${member.dish_name}`}>{member.stall_name} — {member.dish_name}</li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="block" id="people">
            <h2>Who can sign in</h2>
            <p className="hint">Admins see every stall. A lead can open only the stall you assign here.</p>
            <form className="people-form" onSubmit={addPerson}>
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
                <span className="label">Name</span>
                <input
                  value={form.display_name}
                  onChange={(event) => setForm({ ...form, display_name: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Role</span>
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                  <option value="lead">Lead</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {form.role === 'lead' ? (
                <label className="field">
                  <span className="label">Stall</span>
                  <select
                    required
                    value={form.stall_id}
                    onChange={(event) => setForm({ ...form, stall_id: event.target.value })}
                  >
                    {(stalls || []).map((stall) => (
                      <option key={stall.id} value={stall.id}>{stall.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button className="btn btn-primary" type="submit">Add</button>
            </form>
            {notice ? <p className="hint" role="status">{notice}</p> : null}
            <ul className="people">
              {orderedPeople.map((person) => {
                const mine = person.email === profile.email
                return (
                  <li key={person.id}>
                    <div>
                      <strong>{person.display_name || person.email}</strong>
                      <span className="hint">{person.email}{mine ? ' · you' : ''}</span>
                    </div>
                    <label className="field slim">
                      <span className="label">Role</span>
                      <select
                        value={person.role}
                        disabled={mine}
                        onChange={(event) => updatePerson(person, {
                          role: event.target.value,
                          stall_id: event.target.value === 'lead' ? (person.stall_id || stalls[0].id) : null,
                        })}
                      >
                        <option value="lead">Lead</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    {person.role === 'lead' ? (
                      <label className="field slim">
                        <span className="label">Stall</span>
                        <select
                          value={person.stall_id || ''}
                          onChange={(event) => updatePerson(person, { stall_id: event.target.value })}
                        >
                          {(stalls || []).map((stall) => (
                            <option key={stall.id} value={stall.id}>{stall.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : <span />}
                    {mine ? (
                      <span className="hint">This is you</span>
                    ) : removeId === person.id ? (
                      <span className="inline-actions">
                        <button type="button" className="btn btn-quiet" onClick={() => removePerson(person)}>
                          Remove
                        </button>
                        <button type="button" className="btn btn-quiet" onClick={() => setRemoveId(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn-quiet" onClick={() => setRemoveId(person.id)}>
                        Remove
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
