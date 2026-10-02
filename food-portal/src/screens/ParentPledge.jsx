import { useEffect, useState } from 'react'
import { Header } from '../components/Header.jsx'
import { bankPreviewLines } from '../lib/bankDetails.js'
import { allergenList, dietLabel, friendlySaveError, friendlySendError, friendlyVerifyError, spiceLabel, tasteLabel } from '../lib/format.js'
import { phoneAuth } from '../lib/otp.js'
import {
  deadlineOpen,
  dishLimit,
  formatClass,
  sectionLetter,
  stallForAssignedYear,
  stallsStillNeedingFood,
  stillNeeded,
} from '../lib/pledges.js'
import { dishFromDb } from '../lib/plan.js'
import { ASSIGNED_YEAR_GROUPS } from '../lib/yearGroups.js'
import { isDemo, supabase } from '../lib/supabase.js'

const phoneOn = phoneAuth.provider === 'twilio-verify'

export function ParentPledge({ profile, onSignOut }) {
  const [step, setStep] = useState('details')
  const [channel, setChannel] = useState('email')
  const [email, setEmail] = useState(profile?.email && !profile.email.endsWith('@demo.local') ? profile.email : '')
  const [phone, setPhone] = useState('')
  const [children, setChildren] = useState([{ child_name: '', year_group: '', section: '' }])
  const [code, setCode] = useState('')
  const [stalls, setStalls] = useState(null)
  const [dishes, setDishes] = useState([])
  const [remaining, setRemaining] = useState([])
  const [allowBank, setAllowBank] = useState(false)
  const [parent, setParent] = useState(null)
  const [pledges, setPledges] = useState([])
  const [routes, setRoutes] = useState([])
  const [stallId, setStallId] = useState('')
  const [quantities, setQuantities] = useState({})
  const [money, setMoney] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const usePhone = phoneOn && channel === 'phone'

  async function load() {
    const [stallRes, dishRes, settingsRes, parentRes, childRes, pledgeRes, remainRes] = await Promise.all([
      supabase.from('stalls').select('*').order('sort_order'),
      supabase.from('dishes').select('*').order('sort_order'),
      supabase.from('portal_settings').select('allow_bank_details').eq('id', 'portal').maybeSingle(),
      supabase.from('parents').select('*').maybeSingle(),
      supabase.from('parent_children').select('*').order('sort_order'),
      supabase.from('pledges').select('*'),
      supabase.rpc('dish_remaining'),
    ])
    if (stallRes.error || dishRes.error || remainRes.error) {
      setError('The stalls could not be loaded.')
      return null
    }
    const nextStalls = stallRes.data || []
    const nextDishes = (dishRes.data || []).map(dishFromDb)
    const nextRemaining = remainRes.data || []
    setStalls(nextStalls)
    setDishes(nextDishes)
    setRemaining(nextRemaining)
    setAllowBank(Boolean(settingsRes.data?.allow_bank_details))
    setParent(parentRes.data || null)
    setPledges(pledgeRes.data || [])
    return {
      stalls: nextStalls,
      dishes: nextDishes,
      remaining: nextRemaining,
      parent: parentRes.data || null,
      children: childRes.data || [],
      pledges: pledgeRes.data || [],
    }
  }

  useEffect(() => {
    if (isDemo || profile?.user_id) void load()
  }, [profile?.user_id])

  function patchChild(index, partial) {
    setChildren((list) => list.map((child, place) => (place === index ? { ...child, ...partial } : child)))
  }

  function familyError() {
    if (usePhone) {
      if (phone.replace(/\D/g, '').length < 8) return 'Enter a phone number.'
    } else if (!email.trim().includes('@')) {
      return 'Enter an email address.'
    }
    if (!children.length) return 'Add a child.'
    for (const child of children) {
      if (!child.child_name.trim()) return 'Enter your child’s name.'
      if (!child.year_group) return 'Choose a class.'
      if (sectionLetter(child.section) == null) return 'Use a section letter, or leave it blank.'
    }
    return ''
  }

  async function sendCode(event) {
    event.preventDefault()
    const problem = familyError()
    setError(problem)
    if (problem) return
    if (isDemo) {
      setStep('code')
      setCode('')
      return
    }
    setPending(true)
    const { error: sendError } = await supabase.auth.signInWithOtp(
      usePhone
        ? { phone: phone.trim(), options: { channel: 'sms', shouldCreateUser: true, data: { purpose: 'parent' } } }
        : { email: email.trim(), options: { shouldCreateUser: true, data: { purpose: 'parent' } } },
    )
    setPending(false)
    if (sendError) {
      setError(friendlySendError(sendError))
      return
    }
    setStep('code')
    setCode('')
  }

  async function saveFamily(loaded, user) {
    const current = loaded?.parent || parent
    const userId = user?.id || profile?.user_id
    const savedEmail = (user?.email || email || profile?.email || '').trim().toLowerCase()
    const payload = {
      parent_name: current?.parent_name || '',
      child_name: children.map((child) => child.child_name.trim()).join(', '),
      year_group: children.map((child) => formatClass(child.year_group, sectionLetter(child.section) || '')).join(', '),
      phone: usePhone ? phone.trim() : (current?.phone || phone.trim()),
      email: savedEmail,
    }
    let row = current
    if (!row) {
      const inserted = await supabase.from('parents').insert({
        user_id: userId,
        ...payload,
      }).select('*').single()
      if (inserted.error) throw inserted.error
      row = inserted.data
    } else {
      const updated = await supabase.from('parents').update(payload).eq('id', row.id).select('*').single()
      if (updated.error) throw updated.error
      row = updated.data
    }
    setParent(row)
    await supabase.from('parent_children').delete().eq('parent_id', row.id)
    const childRows = children.map((child, index) => ({
      parent_id: row.id,
      child_name: child.child_name.trim(),
      year_group: child.year_group,
      section: sectionLetter(child.section) || '',
      sort_order: index + 1,
    }))
    const stored = await supabase.from('parent_children').insert(childRows).select('*')
    if (stored.error) throw stored.error
    return { parent: row, children: stored.data || childRows }
  }

  function goToStall(loaded, family) {
    const list = family?.children?.length ? family.children : children
    const nextRoutes = list.map((child) => ({
      child,
      stall: stallForAssignedYear(loaded.stalls, child.year_group),
    }))
    setRoutes(nextRoutes)
    const ids = [...new Set(nextRoutes.map((item) => item.stall?.id).filter(Boolean))]
    if (nextRoutes.every((item) => item.stall) && ids.length === 1) {
      setStallId(ids[0])
      setStep('pledge')
      return
    }
    setStep('choose')
  }

  async function verify(token) {
    setError('')
    if (token.length !== 6) return
    setPending(true)
    try {
      let user = null
      if (!isDemo) {
        const { error: verifyError } = await supabase.auth.verifyOtp(
          usePhone
            ? { phone: phone.trim(), token, type: 'sms' }
            : { email: email.trim(), token, type: 'email' },
        )
        if (verifyError) {
          setError(friendlyVerifyError(verifyError))
          setPending(false)
          return
        }
        const signedIn = await supabase.auth.getUser()
        user = signedIn.data.user
      }
      const loaded = await load()
      if (!loaded) {
        setPending(false)
        return
      }
      const family = await saveFamily(loaded, user)
      const again = await load()
      goToStall(again || loaded, family)
    } catch (saveError) {
      setError(friendlySaveError(saveError))
    } finally {
      setPending(false)
    }
  }

  function openStall(id) {
    setStallId(id)
    setQuantities({})
    setMoney('')
    setError('')
    setStep('pledge')
  }

  const stall = stalls?.find((item) => item.id === stallId) || null
  const menu = dishes.filter((dish) => dish.stall_id === stallId && dish.name.trim())
  const open = stall ? deadlineOpen(stall.pledge_deadline) : false
  const wantsFood = stall && (stall.support_type === 'food' || stall.support_type === 'both')
  const wantsMoney = stall && (stall.support_type === 'money' || stall.support_type === 'both')

  function remainFor(dishId) {
    return remaining.find((row) => row.dish_id === dishId) || null
  }

  function ownFood(dishId) {
    return pledges.find((pledge) => pledge.status === 'active' && pledge.kind === 'food' && pledge.dish_id === dishId) || null
  }

  function roomFor(dish) {
    const row = remainFor(dish.id)
    const cap = row?.cap ?? dishLimit(dish)
    if (cap == null) return 0
    const left = row?.remaining ?? stillNeeded(cap, 0)
    return left + (ownFood(dish.id)?.quantity || 0)
  }

  function quantityFor(dish) {
    if (quantities[dish.id] != null) return quantities[dish.id]
    return ownFood(dish.id)?.quantity || 0
  }

  async function savePledge(event) {
    event.preventDefault()
    setError('')
    if (!stall || !parent) return
    if (!open) {
      setError('The pledge deadline has passed.')
      return
    }
    setPending(true)
    try {
      if (wantsFood) {
        for (const dish of menu) {
          const qty = quantityFor(dish)
          const existing = ownFood(dish.id)
          if (!Number.isInteger(qty) || qty < 0) throw new Error('Enter a quantity')
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
        const existing = pledges.find((pledge) => pledge.status === 'active' && pledge.kind === 'money' && pledge.stall_id === stall.id)
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
      await load()
      setStep('done')
    } catch (saveError) {
      setError(friendlySaveError(saveError))
    } finally {
      setPending(false)
    }
  }

  async function cancelPledge(pledge) {
    setPending(true)
    setError('')
    const patch = pledge.kind === 'money'
      ? { status: 'cancelled', money_lkr: 0 }
      : { status: 'cancelled', quantity: 0 }
    const result = await supabase.from('pledges').update(patch).eq('id', pledge.id)
    setPending(false)
    if (result.error) {
      setError(friendlySaveError(result.error))
      return
    }
    await load()
  }

  const active = pledges.filter((pledge) => pledge.status === 'active')
  const bankLines = allowBank && stall ? bankPreviewLines(stall, true) : []
  const needing = stalls ? stallsStillNeedingFood(stalls, dishes, remaining) : []

  return (
    <div className="wrap narrow">
      <Header
        title="Pledge"
        subtitle="A few details, then the food for your child’s class."
        onSignOut={onSignOut}
      />
      {step === 'details' ? (
        <form className="stack" onSubmit={sendCode}>
          {phoneOn ? (
            <fieldset className="choice">
              <legend className="label">How should we reach you?</legend>
              <label className="toggle">
                <input type="radio" name="channel" checked={channel === 'email'} onChange={() => setChannel('email')} />
                Email
              </label>
              <label className="toggle">
                <input type="radio" name="channel" checked={channel === 'phone'} onChange={() => setChannel('phone')} />
                Phone
              </label>
            </fieldset>
          ) : (
            <label className="field">
              <span className="label">Email</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {phoneOn && channel === 'email' ? (
            <label className="field">
              <span className="label">Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          ) : null}
          {usePhone ? (
            <label className="field">
              <span className="label">Phone</span>
              <input inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
          ) : null}
          {children.map((child, index) => (
            <fieldset className="stack" key={index}>
              <legend>{index === 0 ? 'Your child' : 'Second child'}</legend>
              <label className="field">
                <span className="label">Child’s name</span>
                <input
                  aria-label={index === 0 ? 'Child’s name' : 'Second child’s name'}
                  required
                  value={child.child_name}
                  onChange={(event) => patchChild(index, { child_name: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Class</span>
                <select
                  aria-label={index === 0 ? 'Class' : 'Second child’s class'}
                  required
                  value={child.year_group}
                  onChange={(event) => patchChild(index, { year_group: event.target.value })}
                >
                  <option value="">Choose</option>
                  {ASSIGNED_YEAR_GROUPS.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">Section</span>
                <input
                  aria-label={index === 0 ? 'Section' : 'Second child’s section'}
                  maxLength={2}
                  value={child.section}
                  placeholder="A"
                  onChange={(event) => patchChild(index, { section: event.target.value })}
                />
                <span className="hint">Leave blank if the class has no section.</span>
              </label>
            </fieldset>
          ))}
          {children.length < 2 ? (
            <button type="button" className="btn" onClick={() => setChildren([...children, { child_name: '', year_group: '', section: '' }])}>
              Add another child
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setChildren(children.slice(0, 1))}>
              Remove the second child
            </button>
          )}
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Sending…' : usePhone ? 'Text me a code' : 'Email me a code'}
          </button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); void verify(code) }}>
          <label className="field">
            <span className="label">6-digit code</span>
            <input
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <p className="hint">
            {isDemo
              ? 'Demo: enter any 6 digits. Nothing is sent.'
              : `Sent to ${usePhone ? phone.trim() : email.trim()}.`}
          </p>
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending || code.length !== 6}>
            {pending ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => { setStep('details'); setError('') }}>
            Back
          </button>
        </form>
      ) : null}

      {step === 'choose' ? (
        <div className="stack">
          {routes.map((item, index) => {
            const label = formatClass(item.child.year_group, item.child.section)
            return (
              <section className="block" key={`${item.child.child_name}-${index}`}>
                <h2>{item.child.child_name}</h2>
                <p>{label}</p>
                {item.stall ? (
                  <button type="button" className="btn btn-primary" onClick={() => openStall(item.stall.id)}>
                    Pledge for {item.stall.name}
                  </button>
                ) : (
                  <>
                    <p>{label} does not have a food stall yet. You can still help a stall that needs food.</p>
                    {needing.length === 0 ? <p className="hint">Every published dish is full right now.</p> : null}
                    {needing.map((option) => (
                      <button key={option.id} type="button" className="btn" onClick={() => openStall(option.id)}>
                        {option.name}
                      </button>
                    ))}
                  </>
                )}
              </section>
            )
          })}
        </div>
      ) : null}

      {step === 'pledge' && stall ? (
        <form className="stack" onSubmit={savePledge}>
          <h2>{stall.name}</h2>
          <p className="hint">
            {routes.filter((item) => item.stall?.id === stall.id).map((item) => item.child.child_name).filter(Boolean).join(', ')
              || 'Choose what you can bring.'}
          </p>
          {!open ? <p className="banner">The pledge deadline has passed.</p> : null}
          {wantsFood ? menu.map((dish) => {
            const row = remainFor(dish.id)
            const cap = row?.cap ?? dishLimit(dish)
            const left = row?.remaining ?? (cap == null ? null : stillNeeded(cap, 0))
            const qty = quantityFor(dish)
            const room = roomFor(dish)
            const labels = [dietLabel(dish.diet), tasteLabel(dish.taste), spiceLabel(dish.spice), ...allergenList(dish).map((item) => `Contains ${item}`)].filter(Boolean)
            return (
              <article key={dish.id} className="pledge-card">
                <h3>{dish.name}</h3>
                <p className="meta">{labels.join(' · ') || 'No diet or allergen marks yet'}</p>
                <p>{cap == null ? 'This dish has no limit yet' : left <= 0 && qty === 0 ? 'Full' : `${left} of ${cap} still needed`}</p>
                {cap == null || !open ? null : (
                  <div className="stepper">
                    <button type="button" className="btn" aria-label={`Fewer ${dish.name}`} onClick={() => setQuantities({ ...quantities, [dish.id]: Math.max(0, qty - 1) })} disabled={qty <= 0}>−</button>
                    <span aria-live="polite">{qty}</span>
                    <button type="button" className="btn" aria-label={`More ${dish.name}`} onClick={() => setQuantities({ ...quantities, [dish.id]: Math.min(room, qty + 1) })} disabled={qty >= room}>+</button>
                  </div>
                )}
              </article>
            )
          }) : null}
          {wantsMoney ? (
            <label className="field">
              <span className="label">Money pledge (LKR)</span>
              <input inputMode="numeric" value={money} disabled={!open} onChange={(event) => setMoney(event.target.value.replace(/\D/g, ''))} />
              {stall.amount_per_family ? <span className="hint">The stall asked for {stall.amount_per_family}.</span> : null}
            </label>
          ) : null}
          {wantsMoney && bankLines.length ? (
            <div>
              <h3>Bank details</h3>
              {bankLines.map((line) => <p key={line}>{line}</p>)}
            </div>
          ) : null}
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={pending || !open}>
            {pending ? 'Saving…' : 'Confirm pledge'}
          </button>
        </form>
      ) : null}

      {step === 'done' ? (
        <div className="stack">
          <h2>Saved</h2>
          <p>The stall has your pledge. To change it later, open this page again and use the same {usePhone ? 'phone' : 'email'} code.</p>
          {active.length === 0 ? <p className="hint">You have no pledges yet.</p> : null}
          <ul className="plain-list">
            {active.map((pledge) => {
              const dish = dishes.find((item) => item.id === pledge.dish_id)
              const stallName = stalls?.find((item) => item.id === pledge.stall_id)?.name || ''
              return (
                <li key={pledge.id}>
                  <strong>{stallName}</strong>
                  {' · '}
                  {pledge.kind === 'money' ? `LKR ${pledge.money_lkr}` : `${dish?.name || 'Dish'} · ${pledge.quantity}`}
                  <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => cancelPledge(pledge)}>Cancel</button>
                </li>
              )
            })}
          </ul>
          {error ? <p className="banner" role="alert">{error}</p> : null}
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (stallId) setStep('pledge')
              else if (active[0]) openStall(active[0].stall_id)
            }}
          >
            Edit pledge
          </button>
        </div>
      ) : null}
    </div>
  )
}
