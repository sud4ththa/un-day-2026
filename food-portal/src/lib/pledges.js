export const YEAR_GROUPS = [
  'Playgroup',
  'Reception',
  'Nursery',
  ...Array.from({ length: 13 }, (_, index) => `Year ${index + 1}`),
]

export function wholeNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 100000) return null
  return number
}

export function dishLimit(dish) {
  return wholeNumber(dish?.max_quantity) ?? wholeNumber(dish?.target_pieces)
}

export function stillNeeded(limit, pledged) {
  if (limit == null) return null
  return Math.max(0, limit - pledged)
}

export function pledgeAllowed({ limit, pledgedByOthers, quantity }) {
  const pieces = wholeNumber(quantity)
  if (limit == null) return { ok: false, message: 'This dish has no limit yet' }
  if (pieces == null || pieces < 1) return { ok: false, message: 'Enter a quantity' }
  const remaining = stillNeeded(limit, pledgedByOthers)
  if (pieces > remaining) {
    return {
      ok: false,
      message: remaining <= 0 ? 'Full' : `Only ${remaining} still needed`,
    }
  }
  return { ok: true, remaining }
}

export function yearTokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+and\s+|,\s*|\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function deadlineOpen(deadline, now = new Date()) {
  if (!deadline) return true
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now)
  return today <= String(deadline).slice(0, 10)
}

export function suggestedStall(stalls, yearGroup) {
  const want = String(yearGroup || '').trim().toLowerCase()
  if (!want) return null
  return stalls.find((stall) => yearTokens(stall.year_groups).includes(want)) || null
}

export function pledgeCsv(rows) {
  const headers = [
    'stall',
    'parent_name',
    'child_name',
    'year_group',
    'phone',
    'email',
    'dish',
    'quantity',
    'money_lkr',
    'status',
    'removed_reason',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function flattenPledges({ pledges, parents, stalls, dishes }) {
  const parentById = new Map((parents || []).map((parent) => [parent.id, parent]))
  const stallById = new Map((stalls || []).map((stall) => [stall.id, stall]))
  const dishById = new Map((dishes || []).map((dish) => [dish.id, dish]))
  return (pledges || []).map((pledge) => {
    const parent = parentById.get(pledge.parent_id) || {}
    const dish = dishById.get(pledge.dish_id)
    return {
      stall: stallById.get(pledge.stall_id)?.name || pledge.stall_id,
      parent_name: parent.parent_name || '',
      child_name: parent.child_name || '',
      year_group: parent.year_group || '',
      phone: parent.phone || '',
      email: parent.email || '',
      dish: pledge.kind === 'money' ? 'Money' : (dish?.name || ''),
      quantity: pledge.kind === 'food' ? pledge.quantity : '',
      money_lkr: pledge.kind === 'money' ? pledge.money_lkr : '',
      status: pledge.status,
      removed_reason: pledge.removed_reason || '',
    }
  })
}
