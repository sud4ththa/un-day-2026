import { useEffect, useRef, useState } from 'react'
import { DishCard } from '../components/DishCard.jsx'
import { Choice, Field } from '../components/Fields.jsx'
import { Header } from '../components/Header.jsx'
import { Preview } from '../components/Preview.jsx'
import { accountNumberFields, BANK_APPROVAL_NOTE } from '../lib/bankDetails.js'
import { formatWhen, friendlySaveError } from '../lib/format.js'
import { leadPreviewBanner, leadPreviewState } from '../lib/leadPreview.js'
import {
  blankDish,
  dishFromDb,
  dishToDb,
  stallPayload,
  STATUS_LABEL,
  submitGaps,
  SUPPORT_OPTIONS,
  tasteBalance,
} from '../lib/plan.js'
import { findSimilar } from '../lib/similarity.js'
import { supabase } from '../lib/supabase.js'

const AUDIT_KEYS = ['status', 'updated_at', 'updated_by_email', 'submitted_at', 'locked_at']

export function PlanEditor({
  profile,
  stallId,
  onBack,
  onSignOut,
  leadPreview = null,
  onLeadPreviewEditing,
}) {
  const [stall, setStall] = useState(null)
  const [dishes, setDishes] = useState([])
  const [index, setIndex] = useState([])
  const [removed, setRemoved] = useState([])
  const [openId, setOpenId] = useState(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [editTick, setEditTick] = useState(0)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [allowBankDetails, setAllowBankDetails] = useState(false)

  const version = useRef(0)
  const latest = useRef({ stall: null, dishes: [], removed: [] })
  const saving = useRef(false)
  const pending = useRef(null)
  const pause = useRef(false)

  latest.current = { stall, dishes, removed }
  const previewMode = leadPreviewState(leadPreview)
  const isAdmin = profile.role === 'admin' && !previewMode.active
  const readOnly = previewMode.active
    ? !previewMode.editing
    : Boolean(stall && stall.status === 'locked' && profile.role !== 'admin')
  const allowRef = useRef(false)
  allowRef.current = allowBankDetails

  function bump() {
    version.current += 1
    setEditTick((tick) => tick + 1)
    setDirty(true)
  }

  function patchStall(partial) {
    setStall((current) => ({ ...current, ...partial }))
    bump()
  }

  function patchDish(id, partial) {
    setDishes((list) => list.map((dish) => (dish.id === id ? { ...dish, ...partial } : dish)))
    bump()
  }

  async function refreshIndex() {
    const { data } = await supabase.rpc('dish_name_index')
    if (data) setIndex(data)
  }

  useEffect(() => {
    let stop = false
    setReady(false)
    setLoadError('')
    ;(async () => {
      const [stallRes, dishRes, settingsRes] = await Promise.all([
        supabase.from('stalls').select('*').eq('id', stallId).single(),
        supabase.from('dishes').select('*').eq('stall_id', stallId).order('sort_order'),
        supabase.from('portal_settings').select('allow_bank_details').eq('id', 'portal').maybeSingle(),
      ])
      if (stop) return
      if (stallRes.error || !stallRes.data) {
        setLoadError('This stall could not be opened.')
        setReady(true)
        return
      }
      setStall({
        ...stallRes.data,
        year_groups: stallRes.data.year_groups || '',
        amount_per_family: stallRes.data.amount_per_family || '',
        how_to_pay: stallRes.data.how_to_pay || '',
        payment_deadline: stallRes.data.payment_deadline || '',
        food_coordinator_name: stallRes.data.food_coordinator_name || '',
        food_coordinator_phone: stallRes.data.food_coordinator_phone || '',
        dropoff_instructions: stallRes.data.dropoff_instructions || '',
        packaging_note: stallRes.data.packaging_note || '',
        halal_note: stallRes.data.halal_note || '',
        bank_account_name: stallRes.data.bank_account_name || '',
        bank_name: stallRes.data.bank_name || '',
        bank_branch: stallRes.data.bank_branch || '',
        bank_account_number: stallRes.data.bank_account_number || '',
        bank_reference: stallRes.data.bank_reference || '',
      })
      setAllowBankDetails(Boolean(settingsRes.data?.allow_bank_details))
      setDishes((dishRes.data || []).map(dishFromDb))
      setRemoved([])
      setDirty(false)
      setReady(true)
    })()
    return () => {
      stop = true
    }
  }, [stallId])

  useEffect(() => {
    if (!ready) return undefined
    refreshIndex()
    const timer = setInterval(refreshIndex, 20000)
    return () => clearInterval(timer)
  }, [ready, stallId])

  useEffect(() => {
    if (!dirty || !ready || readOnly) return undefined
    const timer = setTimeout(() => {
      void persist('autosave')
    }, 900)
    return () => clearTimeout(timer)
  }, [dirty, editTick, ready, readOnly])

  useEffect(() => {
    function warn(event) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function persist(reason) {
    if (!latest.current.stall || readOnly || pause.current) return
    if (saving.current) {
      pending.current = reason
      return
    }
    const gen = version.current
    const snap = {
      stall: latest.current.stall,
      dishes: latest.current.dishes.map((dish) => ({ ...dish, allergens: [...dish.allergens] })),
      removed: [...latest.current.removed],
    }
    saving.current = true
    setSaveState('saving')
    setSaveError('')
    try {
      const payload = stallPayload(snap.stall, {
        submit: reason === 'submit',
        allowBankDetails: allowRef.current,
      })
      const stallRes = await supabase
        .from('stalls')
        .update(payload)
        .eq('id', snap.stall.id)
        .select(AUDIT_KEYS.join(', '))
        .single()
      if (stallRes.error) throw stallRes.error

      const rows = snap.dishes.map(dishToDb)
      if (rows.length) {
        const upsert = await supabase.from('dishes').upsert(rows, { onConflict: 'id' })
        if (upsert.error) throw upsert.error
      }
      if (snap.removed.length) {
        const del = await supabase.from('dishes').delete().in('id', snap.removed).eq('stall_id', snap.stall.id)
        if (del.error) throw del.error
      }

      setStall((current) => ({
        ...current,
        status: stallRes.data.status,
        updated_at: stallRes.data.updated_at,
        updated_by_email: stallRes.data.updated_by_email,
        submitted_at: stallRes.data.submitted_at,
        locked_at: stallRes.data.locked_at,
      }))
      if (version.current === gen) {
        setDirty(false)
        setRemoved([])
      } else {
        setRemoved((current) => current.filter((id) => !snap.removed.includes(id)))
      }
      setSaveState(reason === 'submit' || stallRes.data.status === 'submitted' ? 'submitted' : 'saved')
      refreshIndex()
    } catch (error) {
      setSaveState('error')
      setSaveError(friendlySaveError(error))
    } finally {
      saving.current = false
      if (pending.current && !pause.current) {
        const next = pending.current
        pending.current = null
        void persist(next)
      }
    }
  }

  async function setLocked(locked) {
    if (!stall) return
    pause.current = true
    pending.current = null
    while (saving.current) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    const status = locked
      ? 'locked'
      : stall.submitted_at || stall.status === 'submitted'
        ? 'submitted'
        : stall.updated_by_email
          ? 'draft'
          : 'not_started'
    setSaveState('saving')
    const { data, error } = await supabase
      .from('stalls')
      .update({ status })
      .eq('id', stall.id)
      .select(AUDIT_KEYS.join(', '))
      .single()
    pause.current = false
    if (error) {
      setSaveState('error')
      setSaveError(friendlySaveError(error))
      return
    }
    version.current += 1
    setStall((current) => ({ ...current, ...data }))
    setDirty(false)
    setSaveState('saved')
  }

  if (!ready) {
    return (
      <div className="wrap">
        <Header title="Food list" onSignOut={onSignOut} />
        <p role="status">Loading this stall…</p>
      </div>
    )
  }

  if (loadError || !stall) {
    return (
      <div className="wrap">
        <Header title="Food list" onBack={onBack} onSignOut={onSignOut} />
        <p className="banner" role="alert">{loadError || 'This stall could not be opened.'}</p>
      </div>
    )
  }

  const balance = tasteBalance(dishes)
  const who = !stall.updated_by_email
    ? ''
    : stall.updated_by_email === profile.email
      ? 'you'
      : stall.updated_by_email
  const savedLine = who ? `Last saved ${formatWhen(stall.updated_at)} by ${who}` : ''
  const saveLabel = previewMode.active && previewMode.readOnly
    ? 'Preview only'
    : saveError
    || (saveState === 'saving' ? 'Saving…' : null)
    || (dirty ? 'Unsaved changes' : null)
    || (saveState === 'submitted' || stall.status === 'submitted' ? 'Submitted' : null)
    || (saveState === 'saved' ? 'All changes saved' : 'Not saved yet')
  const accountHits = allowBankDetails ? [] : accountNumberFields(stall, dishes)
  const showBank = stall.support_type === 'money' || stall.support_type === 'both'

  return (
    <div className="wrap">
      <Header
        title={stall.name}
        onBack={onBack}
        onSignOut={onSignOut}
        backLabel={previewMode.active ? 'Exit' : 'All stalls'}
      >
        <p className="status-line">
          <span className={`pill pill-${stall.status}`}>{STATUS_LABEL[stall.status] || stall.status}</span>
          {savedLine ? <span>{savedLine}</span> : <span>No one has saved this plan yet.</span>}
        </p>
        {stall.status === 'locked' && !isAdmin ? (
          <p className="banner">The PTC has locked this plan. You can still read it.</p>
        ) : null}
        {stall.status === 'locked' && isAdmin ? (
          <p className="banner">Locked for leads. You can still edit it, or unlock the stall.</p>
        ) : null}
        {stall.status !== 'submitted' && stall.status !== 'locked' ? (
          <p className="deadline">Please submit this plan by Tuesday 6 October 2026.</p>
        ) : null}
        {stall.status === 'submitted' ? (
          <p className="deadline">Submitted. You can still edit until the PTC locks the stall.</p>
        ) : null}
        {previewMode.active ? (
          <div className="banner" role="status">
            <p>{leadPreviewBanner(stall.name)}</p>
            <p className="hint">
              {previewMode.editing
                ? `Any edit is saved as ${profile.display_name || profile.email}.`
                : 'Read only, the way a lead sees it.'}
            </p>
            <div className="inline-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (previewMode.editing && dirty) void persist('save')
                  onLeadPreviewEditing?.(!previewMode.editing)
                }}
              >
                {previewMode.editing ? 'Stop editing' : 'Edit this plan'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={onBack}>
                Exit
              </button>
            </div>
          </div>
        ) : null}
        {isAdmin ? (
          <div className="inline-actions">
            {stall.status === 'locked' ? (
              <button type="button" className="btn btn-quiet" onClick={() => setLocked(false)}>
                Unlock
              </button>
            ) : (
              <button type="button" className="btn btn-quiet" onClick={() => setLocked(true)}>
                Lock this stall
              </button>
            )}
          </div>
        ) : null}
      </Header>

      <section className="block">
        <h2>What families contribute</h2>
        <Choice
          name="support"
          legend="Support type"
          value={stall.support_type}
          options={SUPPORT_OPTIONS}
          onChange={(support_type) => patchStall({
            support_type,
            contribution_mode: support_type === 'both' ? stall.contribution_mode : null,
          })}
          disabled={readOnly}
        />
        {stall.support_type === 'money' || stall.support_type === 'both' ? (
          <div className="stack">
            <Field label="Amount per family" hint="For example, LKR 5,000.">
              <input
                value={stall.amount_per_family}
                onChange={(event) => patchStall({ amount_per_family: event.target.value })}
                disabled={readOnly}
              />
            </Field>
            <Field label="How to pay" hint="Bank details, or the name of the person collecting the money.">
              <textarea
                rows={4}
                value={stall.how_to_pay}
                onChange={(event) => patchStall({ how_to_pay: event.target.value })}
                disabled={readOnly}
              />
            </Field>
            <Field label="Deadline" hint="For example, Tuesday 13 October 2026.">
              <input
                value={stall.payment_deadline}
                onChange={(event) => patchStall({ payment_deadline: event.target.value })}
                disabled={readOnly}
              />
            </Field>
          </div>
        ) : null}
        {stall.support_type === 'both' ? (
          <Choice
            name="mode"
            legend="If a family is asked for both"
            value={stall.contribution_mode}
            options={[
              ['either', 'They choose one'],
              ['both', 'They do both'],
            ]}
            onChange={(contribution_mode) => patchStall({ contribution_mode })}
            disabled={readOnly}
          />
        ) : null}
        {stall.support_type === 'money' ? (
          <p className="hint">The parent form will not list dishes while this stall is money only. Dishes you add are kept if you switch back.</p>
        ) : null}
        {accountHits.length ? (
          <p className="warn" role="status">
            This looks like an account number ({accountHits.join('; ')}). {BANK_APPROVAL_NOTE} Take it out of the written notes.
          </p>
        ) : null}
        {showBank ? (
          <div className="bank-block">
            <h3>Bank details</h3>
            {allowBankDetails ? (
              <p className="hint">Parents will see these on the form.</p>
            ) : (
              <p className="banner">{BANK_APPROVAL_NOTE}</p>
            )}
            <fieldset className={allowBankDetails ? 'bank-fields' : 'bank-fields is-off'} disabled={!allowBankDetails || readOnly}>
              <Field label="Account name">
                <input
                  value={stall.bank_account_name}
                  onChange={(event) => patchStall({ bank_account_name: event.target.value })}
                />
              </Field>
              <Field label="Bank">
                <input
                  value={stall.bank_name}
                  onChange={(event) => patchStall({ bank_name: event.target.value })}
                />
              </Field>
              <Field label="Branch">
                <input
                  value={stall.bank_branch}
                  onChange={(event) => patchStall({ bank_branch: event.target.value })}
                />
              </Field>
              <Field label="Account number">
                <input
                  value={stall.bank_account_number}
                  onChange={(event) => patchStall({ bank_account_number: event.target.value })}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Reference to use" hint="For example, the child’s name and class.">
                <input
                  value={stall.bank_reference}
                  onChange={(event) => patchStall({ bank_reference: event.target.value })}
                />
              </Field>
            </fieldset>
          </div>
        ) : null}
      </section>

      <section className="block">
        <h2>Shown on the parent form</h2>
        <p className="hint">Year groups are filled in from last year. Change them if the PTC has moved the stall.</p>
        <div className="split">
          <Field label="Food coordinator">
            <input
              value={stall.food_coordinator_name}
              onChange={(event) => patchStall({ food_coordinator_name: event.target.value })}
              disabled={readOnly}
              autoComplete="name"
            />
          </Field>
          <Field label="Coordinator phone">
            <input
              value={stall.food_coordinator_phone}
              onChange={(event) => patchStall({ food_coordinator_phone: event.target.value })}
              disabled={readOnly}
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
        </div>
        <Field label="Year group or groups">
          <input
            value={stall.year_groups}
            onChange={(event) => patchStall({ year_groups: event.target.value })}
            disabled={readOnly}
            placeholder="Year 5"
          />
        </Field>
        <Field label="Drop-off">
          <textarea
            rows={3}
            value={stall.dropoff_instructions}
            onChange={(event) => patchStall({ dropoff_instructions: event.target.value })}
            disabled={readOnly}
            placeholder="Where and when parents should leave the food"
          />
        </Field>
        <Field label="Packaging">
          <textarea
            rows={2}
            value={stall.packaging_note}
            onChange={(event) => patchStall({ packaging_note: event.target.value })}
            disabled={readOnly}
          />
        </Field>
        <Field label="Halal note" hint="Leave blank if this stall has nothing to say about halal.">
          <textarea
            rows={2}
            value={stall.halal_note}
            onChange={(event) => patchStall({ halal_note: event.target.value })}
            disabled={readOnly}
            placeholder="Any meat provided should be halal."
          />
        </Field>
      </section>

      <section className="block">
        <h2>Dishes</h2>
        <p className="hint">
          {dishes.some((dish) => dish.name.trim())
            ? 'These dishes start from last year’s list. Add, remove, reorder, or edit them.'
            : 'No dishes yet. Add the first one below.'}
        </p>
        <p className="balance" aria-live="polite">
          {balance.sweet} sweet · {balance.savoury} savoury
          {balance.unset ? ` · ${balance.unset} not marked` : ''}
        </p>
        {balance.sweet > balance.savoury ? (
          <p className="warn">More sweet dishes than savoury ones. The PTC has asked stalls to watch that balance.</p>
        ) : null}
        <div className="dishes">
          {dishes.map((dish, position) => (
            <DishCard
              key={dish.id}
              dish={dish}
              index={position}
              total={dishes.length}
              open={openId === dish.id}
              matches={findSimilar(dish.name, index, stall.id)}
              readOnly={readOnly}
              onToggle={() => setOpenId((current) => (current === dish.id ? null : dish.id))}
              onChange={patchDish}
              onMove={(id, delta) => {
                setDishes((list) => {
                  const from = list.findIndex((item) => item.id === id)
                  const to = from + delta
                  if (from < 0 || to < 0 || to >= list.length) return list
                  const next = list.slice()
                  const [item] = next.splice(from, 1)
                  next.splice(to, 0, item)
                  return next
                })
                bump()
              }}
              onRemove={(id) => {
                setDishes((list) => list.filter((item) => item.id !== id))
                setRemoved((ids) => [...ids, id])
                if (openId === id) setOpenId(null)
                bump()
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn"
          disabled={readOnly}
          onClick={() => {
            const dish = blankDish(stall.id)
            setDishes((list) => [...list, dish])
            setOpenId(dish.id)
            bump()
            setTimeout(() => {
              document.getElementById(`dish-${dish.id}-name`)?.focus()
              document.getElementById(`dish-${dish.id}`)?.scrollIntoView({ block: 'center' })
            }, 30)
          }}
        >
          Add a dish
        </button>
      </section>

      <section className="block">
        <h2>Parent form</h2>
        <button type="button" className="btn" onClick={() => setShowPreview((value) => !value)}>
          {showPreview ? 'Hide preview' : 'Preview the parent form'}
        </button>
        {showPreview ? <Preview stall={stall} dishes={dishes} allowBankDetails={allowBankDetails} /> : null}
      </section>

      <div className="savebar">
        <p role="status">{saveLabel}</p>
        {!readOnly ? (
          <div className="actions">
            <button type="button" className="btn" onClick={() => persist('save')}>
              Save
            </button>
            {stall.status === 'submitted' || stall.status === 'locked' ? null : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConfirm(submitGaps(stall, dishes))}
              >
                Submit
              </button>
            )}
          </div>
        ) : (
          <p className="hint">{previewMode.active ? 'Preview only' : 'Locked'}</p>
        )}
      </div>

      {confirm ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal-card">
            <h2 id="confirm-title">Submit this plan to the PTC?</h2>
            <p>You can still edit it until the PTC locks the stall.</p>
            {confirm.length ? (
              <>
                <p>Still open:</p>
                <ul>
                  {confirm.map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              </>
            ) : null}
            <div className="inline-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => {
                  setConfirm(null)
                  void persist('submit')
                }}
              >
                {confirm.length ? 'Submit anyway' : 'Submit'}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
