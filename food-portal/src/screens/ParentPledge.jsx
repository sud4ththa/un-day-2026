import { useEffect, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { Preview } from '../components/Preview.jsx'
import { BANK_APPROVAL_NOTE } from '../lib/bankDetails.js'
import { dishFromDb } from '../lib/plan.js'
import { supabase } from '../lib/supabase.js'

const PLEDGE_KEY = 'un-day-2026-food-demo-pledges'

function loadPledges() {
  try {
    return JSON.parse(localStorage.getItem(PLEDGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function ParentPledge({ onSignOut }) {
  const [stalls, setStalls] = useState(null)
  const [dishes, setDishes] = useState([])
  const [allowBank, setAllowBank] = useState(false)
  const [stallId, setStallId] = useState('india')
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [pledges, setPledges] = useState(() => loadPledges())
  const [form, setForm] = useState({
    parent_name: '',
    child_name: '',
    class_name: '',
    send_food: true,
    send_money: false,
    pieces: {},
  })

  useEffect(() => {
    let stop = false
    ;(async () => {
      const [stallRes, dishRes, settingsRes] = await Promise.all([
        supabase.from('stalls').select('*').order('sort_order'),
        supabase.from('dishes').select('*').order('sort_order'),
        supabase.from('portal_settings').select('allow_bank_details').eq('id', 'portal').maybeSingle(),
      ])
      if (stop) return
      if (stallRes.error || dishRes.error) {
        setError('The stalls could not be loaded.')
        return
      }
      setStalls(stallRes.data)
      setDishes((dishRes.data || []).map(dishFromDb))
      setAllowBank(Boolean(settingsRes.data?.allow_bank_details))
      if (!stallRes.data.some((stall) => stall.id === stallId) && stallRes.data[0]) {
        setStallId(stallRes.data[0].id)
      }
    })()
    return () => {
      stop = true
    }
  }, [stallId])

  const stall = stalls?.find((item) => item.id === stallId) || null
  const menu = dishes.filter((dish) => dish.stall_id === stallId && dish.name.trim())
  const wantsFood = stall && (stall.support_type === 'food' || stall.support_type === 'both')
  const wantsMoney = stall && (stall.support_type === 'money' || stall.support_type === 'both')
  const mustBoth = stall?.support_type === 'both' && stall.contribution_mode === 'both'
  const chooseOne = stall?.support_type === 'both' && stall.contribution_mode === 'either'

  function patch(partial) {
    setForm((current) => ({ ...current, ...partial }))
    setDone(null)
  }

  function submit(event) {
    event.preventDefault()
    setError('')
    const sendFood = mustBoth || stall.support_type === 'food' ? true : form.send_food
    const sendMoney = mustBoth || stall.support_type === 'money' ? true : form.send_money
    if (chooseOne && sendFood === sendMoney) {
      setError('Choose either food or the payment.')
      return
    }
    if (!sendFood && !sendMoney) {
      setError('Choose food or the payment.')
      return
    }
    const chosen = menu
      .filter((dish) => form.pieces[dish.id])
      .map((dish) => ({ name: dish.name, pieces: String(form.pieces[dish.id]).trim() }))
    if (sendFood && chosen.length === 0) {
      setError('Tick at least one dish you can send.')
      return
    }
    const pledge = {
      id: crypto.randomUUID(),
      stall_id: stall.id,
      stall_name: stall.name,
      parent_name: form.parent_name.trim(),
      child_name: form.child_name.trim(),
      class_name: form.class_name.trim(),
      send_food: sendFood,
      send_money: sendMoney,
      dishes: chosen,
      created_at: new Date().toISOString(),
    }
    const next = [pledge, ...pledges]
    setPledges(next)
    localStorage.setItem(PLEDGE_KEY, JSON.stringify(next))
    setDone(pledge)
  }

  return (
    <div className="wrap">
      <Header title="Parent pledge" subtitle="A preview of the form parents would fill in." onSignOut={onSignOut} />
      {!stalls ? <p role="status">Loading stalls…</p> : null}
      {stalls ? (
        <>
          <label className="field">
            <span className="label">Stall</span>
            <select value={stallId} onChange={(event) => { setStallId(event.target.value); setDone(null) }}>
              {stalls.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          {stall ? <Preview stall={stall} dishes={menu} allowBankDetails={allowBank} /> : null}
          {stall && wantsMoney && !allowBank ? <p className="banner">{BANK_APPROVAL_NOTE}</p> : null}
          {stall ? (
            <form className="block stack" onSubmit={submit}>
              <h2>Your pledge</h2>
              <label className="field">
                <span className="label">Your name</span>
                <input required value={form.parent_name} onChange={(event) => patch({ parent_name: event.target.value })} />
              </label>
              <label className="field">
                <span className="label">Child’s name</span>
                <input required value={form.child_name} onChange={(event) => patch({ child_name: event.target.value })} />
              </label>
              <label className="field">
                <span className="label">Class</span>
                <input required value={form.class_name} onChange={(event) => patch({ class_name: event.target.value })} placeholder="Year 10" />
              </label>
              {chooseOne ? (
                <fieldset className="choice">
                  <legend className="label">This stall asks for one</legend>
                  <div className="seg">
                    <label className={form.send_food && !form.send_money ? 'seg-btn on' : 'seg-btn'}>
                      <input type="radio" name="pledge-mode" checked={form.send_food && !form.send_money} onChange={() => patch({ send_food: true, send_money: false })} />
                      I will send food
                    </label>
                    <label className={form.send_money && !form.send_food ? 'seg-btn on' : 'seg-btn'}>
                      <input type="radio" name="pledge-mode" checked={form.send_money && !form.send_food} onChange={() => patch({ send_food: false, send_money: true })} />
                      I will pay {stall.amount_per_family || 'the amount'}
                    </label>
                  </div>
                </fieldset>
              ) : null}
              {mustBoth ? <p>This stall asks each family to send food and to pay {stall.amount_per_family || 'the amount'}.</p> : null}
              {(mustBoth || stall.support_type === 'food' || (chooseOne && form.send_food)) && menu.length ? (
                <fieldset className="choice">
                  <legend className="label">Dishes you can send</legend>
                  <div className="pledge-menu">
                    {menu.map((dish) => (
                      <label key={dish.id} className="pledge-dish">
                        <input
                          type="checkbox"
                          checked={Boolean(form.pieces[dish.id])}
                          onChange={(event) => patch({
                            pieces: {
                              ...form.pieces,
                              [dish.id]: event.target.checked ? (form.pieces[dish.id] || '20') : '',
                            },
                          })}
                        />
                        <span>{dish.name}</span>
                        {form.pieces[dish.id] ? (
                          <input
                            className="pieces"
                            inputMode="numeric"
                            aria-label={`Pieces of ${dish.name}`}
                            value={form.pieces[dish.id]}
                            onChange={(event) => patch({
                              pieces: { ...form.pieces, [dish.id]: event.target.value },
                            })}
                          />
                        ) : null}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {(mustBoth || stall.support_type === 'money' || (chooseOne && form.send_money)) ? (
                <div>
                  <h3>Payment</h3>
                  {stall.amount_per_family ? <p>Amount per family: {stall.amount_per_family}.</p> : null}
                  {stall.how_to_pay ? <p>{stall.how_to_pay}</p> : null}
                </div>
              ) : null}
              {error ? <p className="banner" role="alert">{error}</p> : null}
              {done ? (
                <p className="banner" role="status">
                  Pledge noted for {done.stall_name}. Nothing was sent to the PTC.
                </p>
              ) : null}
              <button className="btn btn-primary" type="submit">Submit pledge</button>
            </form>
          ) : null}
          {pledges.length ? (
            <section className="block">
              <h2>Pledges on this browser</h2>
              <ul className="people">
                {pledges.map((pledge) => (
                  <li key={pledge.id}>
                    <div>
                      <strong>{pledge.parent_name}</strong>
                      <span className="hint">
                        {pledge.stall_name} · {pledge.child_name}, {pledge.class_name}
                        {pledge.send_food ? ` · food (${pledge.dishes.map((dish) => dish.name).join(', ')})` : ''}
                        {pledge.send_money ? ' · payment' : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
