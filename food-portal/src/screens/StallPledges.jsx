import { useEffect, useState } from 'react'
import { download } from '../lib/export.js'
import { flattenPledges, pledgeCsv } from '../lib/pledges.js'
import { supabase } from '../lib/supabase.js'

export function StallPledges({ stallId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    ;(async () => {
      const [pledgeRes, parentRes, dishRes, stallRes] = await Promise.all([
        supabase.from('pledges').select('*').eq('stall_id', stallId),
        supabase.from('parents').select('*'),
        supabase.from('dishes').select('*').eq('stall_id', stallId),
        supabase.from('stalls').select('id, name').eq('id', stallId),
      ])
      if (stop) return
      if (pledgeRes.error || parentRes.error) {
        setError('Pledges could not be loaded.')
        setRows([])
        return
      }
      const active = (pledgeRes.data || []).filter((pledge) => pledge.status === 'active')
      setRows(flattenPledges({
        pledges: active,
        parents: parentRes.data || [],
        stalls: stallRes.data || [],
        dishes: dishRes.data || [],
      }))
    })()
    return () => {
      stop = true
    }
  }, [stallId])

  return (
    <div className="pledge-list">
      <h3>Pledges</h3>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {rows == null ? <p role="status">Loading pledges…</p> : null}
      {rows && rows.length === 0 ? <p className="hint">No pledges yet.</p> : null}
      {rows && rows.length > 0 ? (
        <>
          <ul className="plain-list">
            {rows.map((row) => (
              <li key={`${row.email}:${row.dish}:${row.quantity}:${row.money_lkr}`}>
                <strong>{row.parent_name || row.email}</strong>
                {' · '}
                {row.dish}
                {row.quantity !== '' ? ` · ${row.quantity}` : ''}
                {row.money_lkr !== '' ? ` · LKR ${row.money_lkr}` : ''}
                {' · '}
                {row.phone || 'No phone'}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn"
            onClick={() => download(`pledges-${stallId}.csv`, pledgeCsv(rows), 'text/csv')}
          >
            Download pledges CSV
          </button>
        </>
      ) : null}
    </div>
  )
}
