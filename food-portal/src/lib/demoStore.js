import { BANK_KEYS } from './bankDetails.js'

export const DEMO_STORAGE_KEY = 'un-day-2026-food-demo-v1'

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
  return {
    version: 1,
    stalls: clone(seed.stalls),
    dishes: clone(seed.dishes),
    allowlist: clone(DEMO_PEOPLE),
    portal_settings: [{ id: 'portal', allow_bank_details: false }],
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
      if (parsed?.version !== 1 || !parsed.stalls || !parsed.portal_settings) {
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

  function stallWriteError(actor, stall) {
    if (!actor || actor.role === 'parent') return 'Parents cannot edit a stall plan'
    if (actor.role === 'lead') {
      if (stall.id !== actor.stall_id) return 'row-level security'
      if (stall.status === 'locked') return 'This stall is locked'
    }
    return ''
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

  function visibleRows(state, table, actor) {
    if (table === 'stalls') {
      if (actor.role === 'lead') return state.stalls.filter((stall) => stall.id === actor.stall_id)
      return state.stalls
    }
    if (table === 'dishes') {
      if (actor.role === 'lead') return state.dishes.filter((dish) => dish.stall_id === actor.stall_id)
      return state.dishes
    }
    if (table === 'allowlist') {
      if (actor.role === 'admin') return state.allowlist
      return state.allowlist.filter((person) => person.email === (actor.email || '').toLowerCase())
    }
    if (table === 'portal_settings') return state.portal_settings
    return []
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
      state.allowlist.push(person.row)
      save(state)
      return ok(null)
    }

    if (stateSpec.table === 'allowlist' && stateSpec.op === 'update') {
      if (actor.role !== 'admin') return denied()
      const index = state.allowlist.findIndex(match)
      if (index < 0) return ok(null)
      const merged = normalizePerson({ ...state.allowlist[index], ...stateSpec.payload, id: state.allowlist[index].id })
      if (merged.error) return denied(merged.error)
      const admins = state.allowlist.filter((item) => item.role === 'admin' && item.id !== merged.row.id)
      if (state.allowlist[index].role === 'admin' && merged.row.role !== 'admin' && admins.length === 0) {
        return denied('The list needs at least one admin')
      }
      state.allowlist[index] = merged.row
      save(state)
      return ok(null)
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
  const role = input.role === 'admin' ? 'admin' : 'lead'
  const stallId = role === 'admin' ? null : (input.stall_id || null)
  if (role === 'lead' && !stallId) return { error: 'A lead must be assigned a stall' }
  return {
    row: {
      id: input.id || (globalThis.crypto?.randomUUID?.() || `person-${Date.now()}`),
      email,
      role,
      stall_id: stallId,
      display_name: String(input.display_name || '').trim(),
    },
  }
}

function deniedObject(code, message) {
  return { data: null, error: { message, code } }
}
