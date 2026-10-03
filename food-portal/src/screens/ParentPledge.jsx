import { useEffect, useMemo, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { bankPreviewLines } from '../lib/bankDetails.js'
import { allergenList, dietLabel, friendlySaveError, spiceLabel, tasteLabel } from '../lib/format.js'
import { phoneStoredNote } from '../lib/otp.js'
import { deadlineOpen, dishLimit, stillNeeded, suggestedStall, YEAR_GROUPS } from '../lib/pledges.js'
import { dishFromDb } from '../lib/plan.js'
import { supabase } from '../lib/supabase.js'

export function ParentPledge({ profile, onSignOut }) {
  const [stalls, setStalls] = useState(null)
  const [dishes, setDishes] = useState([])
  const [remaining, setRemaining] = useState([])
  const [parent, setParent] = useState(null)
  const [pledges, setPledges] = useState([])
  const [allowBank, setAllowBank] = useState(false)
  const [stallId, setStallId] = useState('')
  const [stallTouched, setStallTouched] = useState(false)
  const [quantities, setQuantities] = useState({})
  const [money, setMoney] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [form, setForm] = useState({
    parent_name: '',
    child_name: '',
    year_group: '',
    phone: '',
  })

  async function load() {
    const [stallRes, dishRes, settingsRes, parentRes, pledgeRes, remainRes] = await Promise.all([
      supabase.from('stalls').select('*').order('sort_order'),
      supabase.from('dishes').select('*').order('sort_order'),
      supabase.from('portal_settings').select('allow_bank_details').eq('id', 'portal').maybeSingle(),
      supabase.from('parents').select('*').maybeSingle(),
      supabase.from('pledges').select('*'),
      supabase.rpc('dish_remaining'),
    ])
    if (stallRes.error || dishRes.error || remainRes.error) {
      setError('The stalls could not be loaded.')
      return
    }
    let row = parentRes.data
    if (!row) {
      const inserted = await supabase.from('parents').insert({
        user_id: profile.user_id,
        email: profile.email,
        parent_name: '',
        child_name: '',
        year_group: '',
        phone: '',
      }).select('*').single()
      if (inserted.error) {
        setError(friendlySaveError(inserted.error))
        return
      }
      row = inserted.data
    }
    setStalls(stallRes.data || [])
    setDishes((dishRes.data || []).map(dishFromDb))
    setRemaining(remainRes.data || [])
    setAllowBank(Boolean(settingsRes.data?.allow_bank_details))
    setParent(row)
    setPledges(pledgeRes.data || [])
    setForm({
      parent_name: row.parent_name || '',
      child_name: row.child_name || '',
      year_group: row.year_group || '',
      phone: row.phone || '',
    })
    const activeMoney = (pledgeRes.data || []).find((pledge) => pledge.kind === 'money' && pledge.status === 'active')
    if (activeMoney && !stallTouched) setMoney(String(activeMoney.money_lkr || ''))
  }

  useEffect(() => {
    void load()
  }, [])

  const suggestion = useMemo(
    () => (stalls ? suggestedStall(stalls, form.year_group) : null),
    [stalls, form.year_group],
  )

  useEffect(() => {
    if (!stalls || stallTouched) return
    if (suggestion) setStallId(suggestion.id)
    else if (!stallId && stalls[0]) setStallId(stalls[0].id)
  }, [stalls, suggestion, stallTouched, stallId])

  const stall = stalls?.find((item) => item.id === stallId) || null
  const menu = dishes.filter((dish) => dish.stall_id === stallId && dish.name.trim())
  const open = stall ? deadlineOpen(stall.pledge_deadline) : false
  const wantsFood = stall && (stall.support_type === 'food' || stall.support_type === 'both')
  const wantsMoney = stall && (stall.support_type === 'money' || stall.support_type === 'both')
  const mine = pledges.filter((pledge) => pledge.status === 'active')

  function remainFor(dishId) {
    return remaining.find((row) => row.dish_id === dishId) || null
  }

  function ownFood(dishId) {
    return mine.find((pledge) => pledge.kind === 'food' && pledge.dish_id === dishId) || null
  }

  async function saveProfile() {
    const result = await supabase.from('parents').update({
      parent_name: form.parent_name.trim(),
      child_name: form.child_name.trim(),
      year_group: form.year_group,
      phone: form.phone.trim(),
    }).eq('id', parent.id).select('*').single()
    if (result.error) throw result.error
    setParent(result.data)
    return result.data
  }

  async function savePledge(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!form.parent_name.trim() || !form.child_name.trim() || !form.year_group || !form.phone.trim()) {
      setError('Add your name, your child’s name, the year group, and a phone number.')
      return
    }
    if (!stall) {
      setError('Choose a stall.')
      return
    }
    if (!open) {
      setError('The pledge deadline has passed.')
      return
    }
    setPending(true)
    try {
      await saveProfile()
      if (wantsFood) {
        for (const dish of menu) {
          const raw = quantities[dish.id]
          const existing = ownFood(dish.id)
          const qty = raw == null || raw === '' ? (existing ? existing.quantity : 0) : Number(raw)
          if (!Number.isInteger(qty) || qty < 0) {
            throw new Error('Enter a quantity')
          }
          if (qty === 0 && existing) {
            const cancelled = await supabase.from('pledges').update({ status: 'cancelled', quantity: 0 }).eq('id', existing.id)
            if (cancelled.error) throw cancelled.error
          } else if (qty > 0 && existing) {
            const updated = await supabase.from('pledges').update({ quantity: qty, status: 'active' }).eq('id', existing.id)
            if (updated.error) throw updated.error
          } else if (qty > 0) {
            const inserted = await supabase.from('pledges').insert({
              parent_id: parent.id,
              stall_id: stall.id,
              dish_id: dish.id,
              quantity: qty,
              kind: 'food',
              status: 'active',
            })
            if (inserted.error) throw inserted.error
          }
        }
      }
      if (wantsMoney) {
        const existing = mine.find((pledge) => pledge.kind === 'money' && pledge.stall_id === stall.id)
        const amount = money.trim() === '' ? 0 : Number(money)
        if (money.trim() !== '' && (!Number.isInteger(amount) || amount < 0)) throw new Error('Enter an amount')
        if (amount === 0 && existing) {
          const cancelled = await supabase.from('pledges').update({ status: 'cancelled', money_lkr: 0 }).eq('id', existing.id)
          if (cancelled.error) throw cancelled.error
        } else if (amount > 0 && existing) {
          const updated = await supabase.from('pledges').update({ money_lkr: amount, status: 'active' }).eq('id', existing.id)
          if (updated.error) throw updated.error
        } else if (amount > 0) {
          const inserted = await supabase.from('pledges').insert({
            parent_id: parent.id,
            stall_id: stall.id,
            money_lkr: amount,
            kind: 'money',
            status: 'active',
          })
          if (inserted.error) throw inserted.error
        }
      }
      setQuantities({})
      setNotice('Pledge saved.')
      await load()
    } catch (saveError) {
      setError(friendlySaveError(saveError))
    } finally {
      setPending(false)
    }
  }

  async function cancelPledge(pledge) {
    setError('')
    setPending(true)
    const patch = pledge.kind === 'money'
      ? { status: 'cancelled', money_lkr: 0 }
      : { status: 'cancelled', quantity: 0 }
    const result = await supabase.from('pledges').update(patch).eq('id', pledge.id)
    setPending(false)
    if (result.error) {
      setError(friendlySaveError(result.error))
      return
    }
    setNotice('Pledge cancelled.')
    await load()
  }

  const bankLines = allowBank && stall ? bankPreviewLines(stall, true) : []

  return (
    <div className="wrap">
      <Header
        title="Pledge"
        subtitle="Tell the stall what you can bring, or the amount you can pay."
        onSignOut={onSignOut}
      />
      {!stalls ? <p role="status">Loading…</p> : null}
      {stalls && stalls.length === 0 ? <p>No stall has published a plan yet.</p> : null}
      {stall ? (
        <form className="stack" onSubmit={savePledge}>
          <h2>Your family</h2>
          <label className="field">
            <span className="label">Your name</span>
            <input value={form.parent_name} onChange={(event) => setForm({ ...form, parent_name: event.target.value })} required />
          </label>
          <label className="field">
            <span className="label">Child’s name</span>
            <input value={form.child_name} onChange={(event) => setForm({ ...form, child_name: event.target.value })} required />
          </label>
          <label className="field">
            <span className="label">Year group or class</span>
            <select
              value={form.year_group}
              required
              onChange={(event) => {
                const year_group = event.target.value
                setForm({ ...form, year_group })
                if (!stallTouched) {
                  const next = suggestedStall(stalls, year_group)
                  if (next) setStallId(next.id)
                }
              }}
            >
              <option value="">Choose</option>
              {YEAR_GROUPS.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Phone</span>
            <input value={form.phone} inputMode="tel" autoComplete="tel" onChange={(event) => setForm({ ...form, phone: event.target.value })} required />
            <span className="hint">{phoneStoredNote}</span>
          </label>
          <p className="hint">Email: {profile.email}</p>

          <label className="field">
            <span className="label">Stall</span>
            <select
              aria-label="Stall"
              value={stallId}
              onChange={(event) => {
                setStallTouched(true)
                setStallId(event.target.value)
              }}
            >
              {stalls.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{suggestion?.id === item.id ? ' (your child’s stall)' : ''}
                </option>
              ))}
            </select>
          </label>
          {suggestion && suggestion.id !== stallId ? (
            <p className="hint">{suggestion.name} is the stall for {form.year_group}. You can still pledge to this one.</p>
          ) : null}

          <h2>{stall.name}</h2>
          {stall.pledge_deadline ? (
            <p className="hint">Pledges can be changed until {stall.pledge_deadline}.</p>
          ) : (
            <p className="hint">This stall has not set a pledge deadline.</p>
          )}
          {!open ? <p className="banner">The pledge deadline has passed.</p> : null}
          {(stall.food_coordinator_name || stall.food_coordinator_phone) ? (
            <p>
              Questions about food: {stall.food_coordinator_name}
              {stall.food_coordinator_phone ? ` · ${stall.food_coordinator_phone}` : ''}
            </p>
          ) : null}

          {wantsFood ? (
            <div className="pledge-menu">
              {menu.map((dish) => {
                const row = remainFor(dish.id)
                const cap = row?.cap ?? dishLimit(dish)
                const left = row?.remaining ?? (cap == null ? null : stillNeeded(cap, 0))
                const existing = ownFood(dish.id)
                const room = left == null ? null : left + (existing?.quantity || 0)
                const full = room === 0
                const labels = [dietLabel(dish.diet), tasteLabel(dish.taste), spiceLabel(dish.spice), ...allergenList(dish).map((item) => `Contains ${item}`)].filter(Boolean)
                return (
                  <article key={dish.id} className="pledge-card">
                    <h3>{dish.name}</h3>
                    <p className="meta">{labels.join(' · ') || 'No diet or allergen marks yet'}</p>
                    <p>
                      {cap == null ? 'This dish has no limit yet' : full ? 'Full' : `${left} of ${cap} still needed`}
                    </p>
                    {full || cap == null || !open ? null : (
                      <label className="field">
                        <span className="label">Quantity</span>
                        <input
                          className="pieces"
                          inputMode="numeric"
                          aria-label={`Quantity for ${dish.name}`}
                          min="0"
                          max={room || undefined}
                          value={quantities[dish.id] ?? (existing ? String(existing.quantity) : '')}
                          onChange={(event) => setQuantities({ ...quantities, [dish.id]: event.target.value.replace(/\D/g, '') })}
                        />
                      </label>
                    )}
                  </article>
                )
              })}
            </div>
          ) : null}

          {wantsMoney ? (
            <label className="field">
              <span className="label">Money pledge (LKR)</span>
              <input
                inputMode="numeric"
                value={money}
                disabled={!open}
                onChange={(event) => setMoney(event.target.value.replace(/\D/g, ''))}
              />
              {stall.amount_per_family ? <span className="hint">The stall asked for {stall.amount_per_family}.</span> : null}
              {stall.how_to_pay ? <span className="hint">{stall.how_to_pay}</span> : null}
            </label>
          ) : null}
          {wantsMoney && allowBank && bankLines.length ? (
            <div>
              <h3>Bank details</h3>
              {bankLines.map((line) => <p key={line}>{line}</p>)}
            </div>
          ) : null}

          {error ? <p className="banner" role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending || !open}>
            {pending ? 'Saving…' : 'Save pledge'}
          </button>
        </form>
      ) : null}

      <section className="block" id="my-pledges">
        <h2>My pledges</h2>
        {mine.length === 0 ? <p className="hint">You have no pledges yet.</p> : (
          <ul className="plain-list">
            {mine.map((pledge) => {
              const dish = dishes.find((item) => item.id === pledge.dish_id)
              const stallName = stalls?.find((item) => item.id === pledge.stall_id)?.name || ''
              const stallRow = stalls?.find((item) => item.id === pledge.stall_id)
              const canEdit = stallRow ? deadlineOpen(stallRow.pledge_deadline) : false
              return (
                <li key={pledge.id}>
                  <strong>{stallName}</strong>
                  {' · '}
                  {pledge.kind === 'money' ? `LKR ${pledge.money_lkr}` : `${dish?.name || 'Dish'} · ${pledge.quantity}`}
                  {canEdit ? (
                    <button type="button" className="btn btn-quiet" onClick={() => cancelPledge(pledge)} disabled={pending}>
                      Cancel
                    </button>
                  ) : (
                    <span className="hint"> Closed</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
