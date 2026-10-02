import { BANK_KEYS } from './bankDetails.js'
import { deadlineOpen, dishLimit, pledgeAllowed } from './pledges.js'
import { DEMO_ASSIGNED_YEAR_GROUPS } from './yearGroups.js'

export const DEMO_STORAGE_KEY = 'un-day-2026-food-demo-v3'

export const DEMO_PEOPLE = [
  {
    id: 'demo-admin',
    email: 'ptc@demo.local',
    role: 'admin',
    display_name: 'PTC admin',
    stall_id: null,
  },
  {
    id: 'admin-subraja',
    email: 'subraja.subramaniam@pta.britishschool.lk',
    role: 'admin',
    display_name: 'Subraja',
    stall_id: null,
  },
  {
    id: 'admin-zainab',
    email: 'zainab.nuzhan@britishschool.lk',
    role: 'admin',
    display_name: 'Zainab',
    stall_id: null,
  },
  {
    id: 'admin-sudaththa',
    email: 'sudaththa.ariyasena@pta.britishschool.lk',
    role: 'admin',
    display_name: 'Sudaththa',
    stall_id: null,
  },
]

export function createMemoryStorage() {
  const map = new Map()
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function freshDemoState(seed) {
  const stalls = clone(seed.stalls).map((stall) => {
    const published = stall.id === 'india' || stall.id === 'japan'
    const next = {
      ...stall,
      published_to_parents: stall.published_to_parents ?? published,
      pledge_deadline: stall.pledge_deadline ?? (published ? '2026-10-13' : null),
      assigned_year_group: DEMO_ASSIGNED_YEAR_GROUPS[stall.id] || null,
    }
    if (stall.id === 'india' && !next.food_coordinator_name) {
      next.food_coordinator_name = 'Chandi'
      next.food_coordinator_phone = next.food_coordinator_phone || '0773824465'
    }
    return next
  })
  const dishes = clone(seed.dishes).map((dish) => {
    const next = { ...dish }
    if (next.stall_id === 'india' || next.stall_id === 'japan') {
      if (next.max_quantity == null && next.target_pieces == null) {
        next.max_quantity = 40
        next.target_pieces = 40
      } else if (next.max_quantity == null) {
        next.max_quantity = next.target_pieces
      }
    }
    return next
  })
  return {
    version: 3,
    stalls,
    dishes,
    allowlist: clone(DEMO_PEOPLE).map((person) => ({ ...person, phone: person.phone || '' })),
    portal_settings: [{ id: 'portal', allow_bank_details: false }],
    parents: [
      {
        id: 'demo-parent',
        user_id: 'demo-parent',
        email: 'parent@demo.local',
        parent_name: '',
        child_name: '',
        year_group: '',
        phone: '',
      },
    ],
    pledges: [],
  }
}

function denied(message = 'row-level security') {
  return { data: null, error: { message } }
}

function ok(data) {
  return { data, error: null }
}

export function createDemoClient({ storage, getActor, seed }) {
  function load() {
    const raw = storage.getItem(DEMO_STORAGE_KEY)
    if (!raw) {
      const state = freshDemoState(seed)
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
      return state
    }
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.version !== 3 || !parsed.stalls || !parsed.portal_settings || !parsed.pledges) {
        const state = freshDemoState(seed)
        storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
        return state
      }
      return parsed
    } catch {
      const state = freshDemoState(seed)
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
      return state
    }
  }

  function save(state) {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
  }

  function allowBank(state) {
    return Boolean(state.portal_settings[0]?.allow_bank_details)
  }

  function onStall(actor) {
    return actor?.role === 'lead' || actor?.role === 'food_coordinator'
  }

  function stallWriteError(actor, stall) {
    if (!actor || actor.role === 'parent') return 'Parents cannot edit a stall plan'
    if (actor.role === 'admin') return ''
    if (onStall(actor)) {
      if (stall.id !== actor.stall_id) return 'row-level security'
      if (stall.status === 'locked') return 'This stall is locked'
      return ''
    }
    return 'row-level security'
  }

  function applyStallUpdate(row, payload, actor, bankOpen) {
    const blocked = stallWriteError(actor, row)
    if (blocked) return { error: blocked }
    const next = { ...row, ...payload }
    if (!bankOpen) {
      for (const key of BANK_KEYS) next[key] = row[key]
    }
    const now = new Date().toISOString()
    if (actor.role !== 'admin') {
      next.id = row.id
      next.name = row.name
      next.sort_order = row.sort_order
      next.locked_at = row.locked_at
      next.locked_by = row.locked_by
      next.assigned_year_group = row.assigned_year_group
      if (next.status === 'locked') return { error: 'Only the PTC can lock a stall' }
      if (row.status === 'submitted' || next.status === 'submitted') {
        next.status = 'submitted'
        next.submitted_at = row.submitted_at || now
      } else {
        next.status = 'draft'
        next.submitted_at = null
      }
    } else if (next.status === 'locked' && row.status !== 'locked') {
      next.locked_at = next.locked_at || now
      next.locked_by = actor.email
    } else if (next.status !== 'locked') {
      next.locked_at = null
      next.locked_by = null
      if (next.status === 'submitted') next.submitted_at = row.submitted_at || now
      else if (next.status === 'draft' || next.status === 'not_started') next.submitted_at = null
    } else if (next.status === 'submitted') {
      next.submitted_at = row.submitted_at || now
    }
    next.updated_at = now
    next.updated_by_email = (actor.email || '').toLowerCase()
    return { row: next }
  }

  function parentFor(state, actor) {
    const email = (actor.email || '').toLowerCase()
    return state.parents.find((parent) => parent.user_id === actor.user_id || parent.email === email) || null
  }

  function visibleRows(state, table, actor) {
    if (table === 'stalls') {
      if (onStall(actor)) return state.stalls.filter((stall) => stall.id === actor.stall_id)
      if (actor.role === 'parent') return state.stalls.filter((stall) => stall.published_to_parents)
      return state.stalls
    }
    if (table === 'dishes') {
      if (onStall(actor)) return state.dishes.filter((dish) => dish.stall_id === actor.stall_id)
      if (actor.role === 'parent') {
        const open = new Set(state.stalls.filter((stall) => stall.published_to_parents).map((stall) => stall.id))
        return state.dishes.filter((dish) => open.has(dish.stall_id))
      }
      return state.dishes
    }
    if (table === 'allowlist') {
      if (actor.role === 'admin') return state.allowlist
      if (onStall(actor)) {
        return state.allowlist.filter((person) => (
          person.email === (actor.email || '').toLowerCase()
          || (person.stall_id && person.stall_id === actor.stall_id)
        ))
      }
      return state.allowlist.filter((person) => person.email === (actor.email || '').toLowerCase())
    }
    if (table === 'portal_settings') return state.portal_settings
    if (table === 'parents') {
      if (actor.role === 'admin') return state.parents
      if (onStall(actor)) {
        const ids = new Set(
          state.pledges
            .filter((pledge) => pledge.stall_id === actor.stall_id && pledge.status !== 'removed')
            .map((pledge) => pledge.parent_id),
        )
        return state.parents.filter((parent) => ids.has(parent.id))
      }
      const parent = parentFor(state, actor)
      return parent ? [parent] : []
    }
    if (table === 'pledges') {
      if (actor.role === 'admin') return state.pledges
      if (onStall(actor)) {
        return state.pledges.filter((pledge) => pledge.stall_id === actor.stall_id && pledge.status !== 'removed')
      }
      const parent = parentFor(state, actor)
      return parent ? state.pledges.filter((pledge) => pledge.parent_id === parent.id) : []
    }
    return []
  }

  function pledgeError(state, actor, row) {
    const stall = state.stalls.find((item) => item.id === row.stall_id)
    if (!stall) return 'Stall not found'
    if (row.status === 'removed') {
      if (actor.role !== 'admin') return 'Only the PTC can remove a pledge'
      if (!String(row.removed_reason || '').trim()) return 'A reason is required'
      return ''
    }
    if (actor.role !== 'admin') {
      if (!stall.published_to_parents) return 'This stall is not open for pledges'
      if (!deadlineOpen(stall.pledge_deadline)) return 'The pledge deadline has passed'
    }
    if (row.kind === 'food' && row.status === 'active') {
      const dish = state.dishes.find((item) => item.id === row.dish_id)
      if (!dish || dish.stall_id !== row.stall_id) return 'That dish is not on this stall'
      const used = state.pledges
        .filter((pledge) => pledge.dish_id === row.dish_id && pledge.kind === 'food' && pledge.status === 'active' && pledge.id !== row.id)
        .reduce((sum, pledge) => sum + Number(pledge.quantity || 0), 0)
      const check = pledgeAllowed({ limit: dishLimit(dish), pledgedByOthers: used, quantity: row.quantity })
      if (!check.ok) return check.message
    }
    if (row.kind === 'money' && row.status === 'active') {
      if (stall.support_type !== 'money' && stall.support_type !== 'both') return 'This stall is not collecting money'
      const amount = Number(row.money_lkr)
      if (!Number.isInteger(amount) || amount < 1) return 'Enter an amount'
    }
    return ''
  }

  function run(stateSpec) {
    const actor = getActor() || { role: 'parent', email: '' }
    const state = load()
    const rows = () => visibleRows(state, stateSpec.table, actor)

    const match = (row) => stateSpec.filters.every((filter) => {
      if (filter.op === 'eq') return String(row[filter.col] ?? '') === String(filter.val ?? '')
      if (filter.op === 'in') return (filter.val || []).map(String).includes(String(row[filter.col] ?? ''))
      return true
    })

    const finish = (list) => {
      let data = list
      if (stateSpec.orderBy) {
        const key = stateSpec.orderBy
        data = data.slice().sort((a, b) => {
          if (typeof a[key] === 'number' && typeof b[key] === 'number') return a[key] - b[key]
          return String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
        })
      }
      if (stateSpec.limitOne === 'one') {
        if (data.length !== 1) return denied('JSON object requested, multiple (or no) rows returned')
        return ok(pick(data[0], stateSpec.cols))
      }
      if (stateSpec.limitOne === 'maybe') return ok(data[0] ? pick(data[0], stateSpec.cols) : null)
      if (stateSpec.returning) return ok(data.map((row) => pick(row, stateSpec.cols)))
      return ok(data.map((row) => pick(row, stateSpec.cols)))
    }

    if (stateSpec.op === 'select') return finish(rows().filter(match))

    if (stateSpec.table === 'portal_settings' && stateSpec.op === 'update') {
      if (actor.role !== 'admin') return denied()
      state.portal_settings[0] = { ...state.portal_settings[0], ...stateSpec.payload }
      save(state)
      return finish(state.portal_settings.filter(match))
    }

    if (stateSpec.table === 'stalls' && stateSpec.op === 'update') {
      const targets = state.stalls.filter((stall) => match(stall) && rows().some((row) => row.id === stall.id))
      if (!targets.length) return denied('row-level security')
      const nextRows = []
      for (const stall of targets) {
        const applied = applyStallUpdate(stall, stateSpec.payload, actor, allowBank(state))
        if (applied.error) return denied(applied.error)
        const index = state.stalls.findIndex((item) => item.id === stall.id)
        state.stalls[index] = applied.row
        nextRows.push(applied.row)
      }
      save(state)
      return finish(nextRows)
    }

    if (stateSpec.table === 'dishes' && (stateSpec.op === 'upsert' || stateSpec.op === 'insert')) {
      const incoming = Array.isArray(stateSpec.payload) ? stateSpec.payload : [stateSpec.payload]
      for (const dish of incoming) {
        const stall = state.stalls.find((item) => item.id === dish.stall_id)
        if (!stall) return denied('You can only edit your own stall')
        const blocked = stallWriteError(actor, stall)
        if (blocked) return denied(blocked)
        const index = state.dishes.findIndex((item) => item.id === dish.id)
        if (index >= 0) state.dishes[index] = { ...state.dishes[index], ...dish }
        else state.dishes.push({ ...dish })
      }
      save(state)
      return ok(null)
    }

    if (stateSpec.table === 'dishes' && stateSpec.op === 'delete') {
      const doomed = state.dishes.filter(match)
      for (const dish of doomed) {
        const stall = state.stalls.find((item) => item.id === dish.stall_id)
        const blocked = stall ? stallWriteError(actor, stall) : 'You can only edit your own stall'
        if (blocked) return denied(blocked)
      }
      const ids = new Set(doomed.map((dish) => dish.id))
      state.dishes = state.dishes.filter((dish) => !ids.has(dish.id))
      save(state)
      return ok(null)
    }

    if (stateSpec.table === 'allowlist' && stateSpec.op === 'insert') {
      if (actor.role !== 'admin') return denied()
      const person = normalizePerson(stateSpec.payload)
      if (person.error) return denied(person.error)
      if (state.allowlist.some((item) => item.email === person.row.email)) {
        return deniedObject('23505', 'That email is already on the list.')
      }
      if (slotTaken(state.allowlist, person.row)) return denied(slotMessage(person.row.role))
      state.allowlist.push(person.row)
      save(state)
      return finish([person.row])
    }

    if (stateSpec.table === 'allowlist' && stateSpec.op === 'update') {
      if (actor.role !== 'admin') return denied()
      const index = state.allowlist.findIndex(match)
      if (index < 0) return ok(null)
      const merged = normalizePerson({ ...state.allowlist[index], ...stateSpec.payload, id: state.allowlist[index].id })
      if (merged.error) return denied(merged.error)
      if (slotTaken(state.allowlist, merged.row)) return denied(slotMessage(merged.row.role))
      const admins = state.allowlist.filter((item) => item.role === 'admin' && item.id !== merged.row.id)
      if (state.allowlist[index].role === 'admin' && merged.row.role !== 'admin' && admins.length === 0) {
        return denied('The list needs at least one admin')
      }
      state.allowlist[index] = merged.row
      save(state)
      return ok(null)
    }

    if (stateSpec.table === 'parents' && stateSpec.op === 'insert') {
      if (actor.role !== 'parent' && actor.role !== 'admin') return denied()
      const email = (actor.role === 'parent' ? actor.email : stateSpec.payload.email || '').toLowerCase()
      const userId = actor.role === 'parent' ? (actor.user_id || email) : stateSpec.payload.user_id
      if (state.parents.some((parent) => parent.user_id === userId || parent.email === email)) {
        return deniedObject('23505', 'That parent already exists.')
      }
      const row = {
        id: stateSpec.payload.id || randomId(),
        user_id: userId,
        email,
        parent_name: String(stateSpec.payload.parent_name || '').trim(),
        child_name: String(stateSpec.payload.child_name || '').trim(),
        year_group: String(stateSpec.payload.year_group || '').trim(),
        phone: String(stateSpec.payload.phone || '').trim(),
      }
      state.parents.push(row)
      save(state)
      return finish([row])
    }

    if (stateSpec.table === 'parents' && stateSpec.op === 'update') {
      const targets = state.parents.filter((parent) => match(parent) && rows().some((row) => row.id === parent.id))
      if (!targets.length) return denied('row-level security')
      const nextRows = []
      for (const parent of targets) {
        const next = {
          ...parent,
          ...stateSpec.payload,
          id: parent.id,
          user_id: parent.user_id,
          email: parent.email,
        }
        const index = state.parents.findIndex((item) => item.id === parent.id)
        state.parents[index] = next
        nextRows.push(next)
      }
      save(state)
      return finish(nextRows)
    }

    if (stateSpec.table === 'pledges' && stateSpec.op === 'insert') {
      if (actor.role !== 'parent') return denied('row-level security')
      const parent = parentFor(state, actor)
      if (!parent) return denied('Save your name before pledging')
      const row = {
        ...stateSpec.payload,
        id: stateSpec.payload.id || randomId(),
        parent_id: parent.id,
        status: 'active',
        removed_reason: null,
        removed_by: null,
      }
      const problem = pledgeError(state, actor, row)
      if (problem) return denied(problem)
      state.pledges.push(row)
      save(state)
      return finish([row])
    }

    if (stateSpec.table === 'pledges' && stateSpec.op === 'update') {
      const targets = state.pledges.filter((pledge) => match(pledge) && rows().some((row) => row.id === pledge.id))
      if (!targets.length) return denied('row-level security')
      const nextRows = []
      for (const pledge of targets) {
        const next = { ...pledge, ...stateSpec.payload, id: pledge.id, parent_id: pledge.parent_id }
        if (actor.role !== 'admin') {
          next.removed_reason = pledge.removed_reason
          next.removed_by = pledge.removed_by
        }
        const problem = pledgeError(state, actor, next)
        if (problem) return denied(problem)
        const index = state.pledges.findIndex((item) => item.id === pledge.id)
        state.pledges[index] = next
        nextRows.push(next)
      }
      save(state)
      return finish(nextRows)
    }

    if (stateSpec.table === 'allowlist' && stateSpec.op === 'delete') {
      if (actor.role !== 'admin') return denied()
      const doomed = state.allowlist.filter(match)
      const remainingAdmins = state.allowlist.filter((item) => item.role === 'admin' && !doomed.some((gone) => gone.id === item.id))
      if (remainingAdmins.length === 0) return denied('The list needs at least one admin')
      const ids = new Set(doomed.map((item) => item.id))
      state.allowlist = state.allowlist.filter((item) => !ids.has(item.id))
      save(state)
      return ok(null)
    }

    return denied('This change was not allowed.')
  }

  function from(table) {
    const stateSpec = {
      table,
      op: 'select',
      filters: [],
      orderBy: null,
      limitOne: null,
      payload: null,
      cols: '*',
      returning: false,
    }
    const api = {
      select(cols = '*') {
        stateSpec.cols = cols
        stateSpec.returning = stateSpec.op !== 'select'
        if (stateSpec.op === 'select') stateSpec.op = 'select'
        return api
      },
      insert(row) {
        stateSpec.op = 'insert'
        stateSpec.payload = row
        return api
      },
      upsert(rows) {
        stateSpec.op = 'upsert'
        stateSpec.payload = rows
        return api
      },
      update(row) {
        stateSpec.op = 'update'
        stateSpec.payload = row
        return api
      },
      delete() {
        stateSpec.op = 'delete'
        return api
      },
      eq(col, val) {
        stateSpec.filters.push({ op: 'eq', col, val })
        return api
      },
      in(col, val) {
        stateSpec.filters.push({ op: 'in', col, val })
        return api
      },
      order(col) {
        stateSpec.orderBy = col
        return api
      },
      single() {
        stateSpec.limitOne = 'one'
        return api
      },
      maybeSingle() {
        stateSpec.limitOne = 'maybe'
        return api
      },
      then(onOk, onErr) {
        return Promise.resolve().then(() => run(stateSpec)).then(onOk, onErr)
      },
    }
    return api
  }

  return {
    from,
    rpc(name) {
      if (name === 'dish_remaining') {
        const actor = getActor()
        if (!actor) return Promise.resolve(ok([]))
        const state = load()
        const open = new Set(state.stalls.filter((stall) => stall.published_to_parents).map((stall) => stall.id))
        return Promise.resolve(ok(
          state.dishes.filter((dish) => open.has(dish.stall_id)).map((dish) => {
            const cap = dishLimit(dish)
            const pledged = state.pledges
              .filter((pledge) => pledge.dish_id === dish.id && pledge.kind === 'food' && pledge.status === 'active')
              .reduce((sum, pledge) => sum + Number(pledge.quantity || 0), 0)
            return {
              dish_id: dish.id,
              stall_id: dish.stall_id,
              cap,
              pledged,
              remaining: cap == null ? null : Math.max(0, cap - pledged),
            }
          }),
        ))
      }
      if (name !== 'dish_name_index') return Promise.resolve(denied('Unknown call'))
      const actor = getActor()
      if (!actor || actor.role === 'parent') return Promise.resolve(ok([]))
      const state = load()
      const names = new Map(state.stalls.map((stall) => [stall.id, stall.name]))
      return Promise.resolve(ok(
        state.dishes
          .filter((dish) => dish.name && dish.name.trim())
          .map((dish) => ({
            stall_id: dish.stall_id,
            stall_name: names.get(dish.stall_id) || dish.stall_id,
            dish_name: dish.name,
          })),
      ))
    },
    auth: {
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signOut() {},
      async signInWithOtp() {
        return { error: { message: 'The demo does not send codes.' } }
      },
      async verifyOtp() {
        return { error: { message: 'The demo does not send codes.' } }
      },
    },
  }
}

function pick(row, cols) {
  if (!row || !cols || cols === '*') return row
  const out = {}
  for (const key of String(cols).split(',').map((item) => item.trim()).filter(Boolean)) {
    out[key] = row[key]
  }
  return out
}

function normalizePerson(input) {
  const email = String(input.email || '').trim().toLowerCase()
  if (!email.includes('@')) return { error: 'Enter an email address.' }
  const role = input.role === 'food_coordinator'
    ? 'food_coordinator'
    : input.role === 'admin'
      ? 'admin'
      : 'lead'
  const stallId = role === 'admin' ? null : (input.stall_id || null)
  if (role !== 'admin' && !stallId) return { error: 'Choose a stall' }
  return {
    row: {
      id: input.id || (globalThis.crypto?.randomUUID?.() || `person-${Date.now()}`),
      email,
      role,
      stall_id: stallId,
      display_name: String(input.display_name || '').trim(),
      phone: String(input.phone || '').trim(),
    },
  }
}

function slotTaken(people, row) {
  if (!row.stall_id || (row.role !== 'lead' && row.role !== 'food_coordinator')) return false
  return people.some((item) => item.id !== row.id && item.stall_id === row.stall_id && item.role === row.role)
}

function slotMessage(role) {
  return role === 'food_coordinator'
    ? 'This stall already has a food coordinator'
    : 'This stall already has a lead'
}

function deniedObject(code, message) {
  return { data: null, error: { message, code } }
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
