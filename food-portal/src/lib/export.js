const STALL_FIELDS = [
  ['stall_id', (stall) => stall.id],
  ['stall_name', (stall) => stall.name],
  ['status', (stall) => stall.status],
  ['year_groups', (stall) => stall.year_groups],
  ['assigned_year_group', (stall) => stall.assigned_year_group || ''],
  ['lead_name', (stall, people) => personField(stall, people, 'lead', 'display_name')],
  ['lead_email', (stall, people) => personField(stall, people, 'lead', 'email')],
  ['lead_phone', (stall, people) => personField(stall, people, 'lead', 'phone')],
  ['coordinator_name', (stall, people) => personField(stall, people, 'food_coordinator', 'display_name')],
  ['coordinator_email', (stall, people) => personField(stall, people, 'food_coordinator', 'email')],
  ['coordinator_phone', (stall, people) => personField(stall, people, 'food_coordinator', 'phone')],
  ['support_type', (stall) => stall.support_type],
  ['amount_per_family', (stall) => stall.amount_per_family],
  ['how_to_pay', (stall) => stall.how_to_pay],
  ['bank_account_name', (stall) => stall.bank_account_name],
  ['bank_name', (stall) => stall.bank_name],
  ['bank_branch', (stall) => stall.bank_branch],
  ['bank_account_number', (stall) => stall.bank_account_number],
  ['bank_reference', (stall) => stall.bank_reference],
  ['payment_deadline', (stall) => stall.payment_deadline],
  ['contribution_mode', (stall) => stall.contribution_mode],
  ['food_coordinator_name', (stall) => stall.food_coordinator_name],
  ['food_coordinator_phone', (stall) => stall.food_coordinator_phone],
  ['dropoff_instructions', (stall) => stall.dropoff_instructions],
  ['packaging_note', (stall) => stall.packaging_note],
  ['halal_note', (stall) => stall.halal_note],
  ['submitted_at', (stall) => stall.submitted_at],
  ['locked_at', (stall) => stall.locked_at],
  ['updated_at', (stall) => stall.updated_at],
  ['updated_by_email', (stall) => stall.updated_by_email],
]

const DISH_FIELDS = [
  ['dish_name', (dish) => dish?.name ?? ''],
  ['diet', (dish) => dish?.diet ?? ''],
  ['allergens', (dish) => (dish?.allergens || []).join('|')],
  ['allergen_other', (dish) => dish?.allergen_other ?? ''],
  ['spice', (dish) => dish?.spice ?? ''],
  ['taste', (dish) => dish?.taste ?? ''],
  ['made_by', (dish) => dish?.made_by ?? ''],
  ['caterer_name', (dish) => dish?.caterer_name ?? ''],
  ['caterer_contact', (dish) => dish?.caterer_contact ?? ''],
  ['target_pieces', (dish) => (dish && dish.target_pieces != null ? dish.target_pieces : '')],
  ['notes', (dish) => dish?.notes ?? ''],
  ['sort_order', (dish) => (dish ? dish.sort_order : '')],
]

export const CSV_HEADERS = [
  ...STALL_FIELDS.map(([name]) => name),
  ...DISH_FIELDS.map(([name]) => name),
]

function csvCell(value) {
  const text = value == null ? '' : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function dishesFor(stall, dishes) {
  return dishes
    .filter((dish) => dish.stall_id === stall.id)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
}

function personField(stall, people, role, field) {
  const person = (people || []).find((item) => item.stall_id === stall.id && item.role === role)
  return person?.[field] || ''
}

export function toCsv(stalls, dishes, people = []) {
  const lines = [CSV_HEADERS.map(csvCell).join(',')]
  for (const stall of stalls) {
    const list = dishesFor(stall, dishes)
    const rows = list.length ? list : [null]
    for (const dish of rows) {
      const values = [
        ...STALL_FIELDS.map(([, read]) => read(stall, people)),
        ...DISH_FIELDS.map(([, read]) => read(dish)),
      ]
      lines.push(values.map(csvCell).join(','))
    }
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export function toJson(stalls, dishes, people = []) {
  return {
    event: 'UN Day 2026',
    school: 'The British School in Colombo',
    group: 'Parent Collective',
    exported_at: new Date().toISOString(),
    stalls: stalls.map((stall) => {
      const summary = Object.fromEntries(STALL_FIELDS.map(([name, read]) => [name, read(stall, people)]))
      return {
        ...summary,
        dishes: dishesFor(stall, dishes).map((dish) =>
          Object.fromEntries(DISH_FIELDS.map(([name, read]) => [name, read(dish)])),
        ),
      }
    }),
  }
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
