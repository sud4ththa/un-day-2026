import { useEffect, useMemo, useState } from 'react'
import { download } from '../lib/export.js'
import { friendlySaveError } from '../lib/format.js'
import { flattenPledges, pledgeCsv } from '../lib/pledges.js'
import { supabase } from '../lib/supabase.js'

export function AdminPledges({ profile }) {
  const [pledges, setPledges] = useState(null)
  const [parents, setParents] = useState([])
  const [dishes, setDishes] = useState([])
  const [stalls, setStalls] = useState([])
  const [error, setError] = useState('')
  const [reasonFor, setReasonFor] = useState(null)
  const [reason, setReason] = useState('Spam')

  async function load() {
    const [pledgeRes, parentRes, dishRes, stallRes] = await Promise.all([
      supabase.from('pledges').select('*'),
      supabase.from('parents').select('*'),
      supabase.from('dishes').select('id, stall_id, name'),
      supabase.from('stalls').select('id, name, sort_order').order('sort_order'),
    ])
    if (pledgeRes.error || parentRes.error || dishRes.error || stallRes.error) {
      setError('Pledges could not be loaded.')
      return
    }
    setPledges(pledgeRes.data || [])
    setParents(parentRes.data || [])
    setDishes(dishRes.data || [])
    setStalls(stallRes.data || [])
  }

  useEffect(() => {
    void load()
  }, [])

  const active = (pledges || []).filter((pledge) => pledge.status === 'active')
  const parentCount = new Set(active.map((pledge) => pledge.parent_id)).size

  const moneyByStall = useMemo(() => {
    return stalls.map((stall) => ({
      id: stall.id,
      name: stall.name,
      money: active
        .filter((pledge) => pledge.stall_id === stall.id && pledge.kind === 'money')
        .reduce((sum, pledge) => sum + Number(pledge.money_lkr || 0), 0),
    })).filter((row) => row.money > 0)
  }, [stalls, active])

  const foodRows = useMemo(() => {
    const dishById = new Map(dishes.map((dish) => [dish.id, dish]))
    const stallById = new Map(stalls.map((stall) => [stall.id, stall]))
    const totals = new Map()
    for (const pledge of active) {
      if (pledge.kind !== 'food') continue
      const dish = dishById.get(pledge.dish_id)
      const key = `${pledge.stall_id}:${pledge.dish_id}`
      const current = totals.get(key) || {
        stall: stallById.get(pledge.stall_id)?.name || pledge.stall_id,
        dish: dish?.name || 'Dish',
        quantity: 0,
      }
      current.quantity += Number(pledge.quantity || 0)
      totals.set(key, current)
    }
    return [...totals.values()].sort((a, b) => a.stall.localeCompare(b.stall) || a.dish.localeCompare(b.dish))
  }, [active, dishes, stalls])

  const flat = flattenPledges({ pledges: pledges || [], parents, stalls, dishes })

  async function removePledge(pledge) {
    setError('')
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Add a reason.')
      return
    }
    const result = await supabase
      .from('pledges')
      .update({
        status: 'removed',
        removed_reason: trimmed,
        removed_by: profile.email,
      })
      .eq('id', pledge.id)
    if (result.error) {
      setError(friendlySaveError(result.error))
      return
    }
    setReasonFor(null)
    setReason('Spam')
    await load()
  }

  return (
    <section className="block" id="pledge-totals">
      <h2>Pledges</h2>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {pledges == null ? <p role="status">Loading pledges…</p> : null}
      {pledges ? (
        <>
          <p className="balance">{parentCount} {parentCount === 1 ? 'parent' : 'parents'} with a pledge</p>
          <h3>Food pieces</h3>
          {foodRows.length === 0 ? <p className="hint">No food pledged yet.</p> : (
            <table className="totals">
              <thead>
                <tr><th>Stall</th><th>Dish</th><th>Pieces</th></tr>
              </thead>
              <tbody>
                {foodRows.map((row) => (
                  <tr key={`${row.stall}:${row.dish}`}>
                    <td>{row.stall}</td>
                    <td>{row.dish}</td>
                    <td>{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Money pledged</h3>
          {moneyByStall.length === 0 ? <p className="hint">No money pledged yet.</p> : (
            <table className="totals">
              <thead>
                <tr><th>Stall</th><th>LKR</th></tr>
              </thead>
              <tbody>
                {moneyByStall.map((row) => (
                  <tr key={row.id}><td>{row.name}</td><td>{row.money}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Every pledge</h3>
          {flat.length === 0 ? <p className="hint">No pledges yet.</p> : (
            <ul className="plain-list">
              {(pledges || []).map((pledge) => {
                const line = flat.find((row) => rowMatches(row, pledge, parents, dishes))
                return (
                  <li key={pledge.id}>
                    <strong>{line?.parent_name || 'Parent'}</strong>
                    {' · '}
                    {line?.stall}
                    {' · '}
                    {line?.dish}
                    {pledge.quantity ? ` · ${pledge.quantity}` : ''}
                    {pledge.money_lkr ? ` · LKR ${pledge.money_lkr}` : ''}
                    {' · '}
                    {pledge.status}
                    {pledge.removed_reason ? ` · ${pledge.removed_reason}` : ''}
                    {pledge.status !== 'removed' ? (
                      reasonFor === pledge.id ? (
                        <span className="inline-actions">
                          <input
                            aria-label="Reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <button type="button" className="btn btn-primary" onClick={() => removePledge(pledge)}>
                            Remove
                          </button>
                          <button type="button" className="btn btn-quiet" onClick={() => setReasonFor(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn btn-quiet" onClick={() => { setReasonFor(pledge.id); setReason('Spam') }}>
                          Remove
                        </button>
                      )
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => download('un-day-pledges.csv', pledgeCsv(flat), 'text/csv')}>
            Download pledges CSV
          </button>
        </>
      ) : null}
    </section>
  )
}

function rowMatches(row, pledge, parents, dishes) {
  const parent = parents.find((item) => item.id === pledge.parent_id)
  const dish = dishes.find((item) => item.id === pledge.dish_id)
  return row.email === (parent?.email || '')
    && row.status === pledge.status
    && (pledge.kind === 'money' ? row.dish === 'Money' : row.dish === (dish?.name || ''))
}
