export const SUPPORT_OPTIONS = [
  ['food', 'Food only'],
  ['money', 'Money only'],
  ['both', 'Both'],
]

export const DIET_OPTIONS = [
  ['veg', 'Vegetarian'],
  ['non_veg', 'Non-veg'],
  ['vegan', 'Vegan'],
]

export const TASTE_OPTIONS = [
  ['sweet', 'Sweet'],
  ['savoury', 'Savoury'],
]

export const SPICE_OPTIONS = [
  ['none', 'None'],
  ['mild', 'Mild'],
  ['medium', 'Medium'],
  ['hot', 'Hot'],
]

export const MADE_OPTIONS = [
  ['home', 'Home or a parent'],
  ['caterer', 'A caterer'],
]

export const ALLERGENS = [
  ['nuts', 'Nuts'],
  ['dairy', 'Dairy'],
  ['gluten', 'Gluten'],
  ['egg', 'Egg'],
  ['seafood', 'Seafood'],
  ['other', 'Other'],
]

export const STATUS_LABEL = {
  not_started: 'Not started',
  draft: 'Draft',
  submitted: 'Submitted',
  locked: 'Locked',
}

export function blankDish(stallId) {
  return {
    id: crypto.randomUUID(),
    stall_id: stallId,
    name: '',
    diet: null,
    allergens: [],
    allergen_other: '',
    spice: null,
    taste: null,
    made_by: 'home',
    caterer_name: '',
    caterer_contact: '',
    target_pieces: '',
    max_quantity: '',
    notes: '',
    sort_order: 0,
  }
}

export function dishFromDb(row) {
  return {
    id: row.id,
    stall_id: row.stall_id,
    name: row.name || '',
    diet: row.diet,
    allergens: row.allergens || [],
    allergen_other: row.allergen_other || '',
    spice: row.spice,
    taste: row.taste,
    made_by: row.made_by || 'home',
    caterer_name: row.caterer_name || '',
    caterer_contact: row.caterer_contact || '',
    target_pieces: row.target_pieces == null ? '' : String(row.target_pieces),
    max_quantity: row.max_quantity == null ? '' : String(row.max_quantity),
    notes: row.notes || '',
    sort_order: row.sort_order,
  }
}

export function dishToDb(dish, index) {
  const raw = String(dish.target_pieces ?? '').trim()
  const pieces = raw === '' ? null : Number(raw)
  const target = Number.isInteger(pieces) && pieces >= 0 && pieces <= 100000 ? pieces : null
  const maxRaw = String(dish.max_quantity ?? '').trim()
  const maxParsed = maxRaw === '' ? null : Number(maxRaw)
  const maxQuantity = Number.isInteger(maxParsed) && maxParsed >= 0 && maxParsed <= 100000 ? maxParsed : null
  const allergens = Array.isArray(dish.allergens) ? dish.allergens : []
  const caterer = dish.made_by === 'caterer'
  return {
    id: dish.id,
    stall_id: dish.stall_id,
    name: dish.name.trim(),
    diet: dish.diet || null,
    allergens,
    allergen_other: allergens.includes('other') ? dish.allergen_other.trim() : '',
    spice: dish.spice || null,
    taste: dish.taste || null,
    made_by: caterer ? 'caterer' : 'home',
    caterer_name: caterer ? dish.caterer_name.trim() : '',
    caterer_contact: caterer ? dish.caterer_contact.trim() : '',
    target_pieces: target,
    max_quantity: maxQuantity,
    notes: dish.notes.trim(),
    sort_order: index + 1,
  }
}

export function nextStatus(current, { submit }) {
  if (submit) return 'submitted'
  if (current === 'locked' || current === 'submitted') return current
  return 'draft'
}

export function stallPayload(stall, { submit, allowBankDetails = false }) {
  const payload = {
    year_groups: stall.year_groups.trim(),
    support_type: stall.support_type,
    amount_per_family: stall.amount_per_family.trim(),
    how_to_pay: stall.how_to_pay.trim(),
    payment_deadline: stall.payment_deadline.trim(),
    contribution_mode: stall.support_type === 'both' ? stall.contribution_mode : null,
    food_coordinator_name: stall.food_coordinator_name.trim(),
    food_coordinator_phone: stall.food_coordinator_phone.trim(),
    dropoff_instructions: stall.dropoff_instructions.trim(),
    packaging_note: stall.packaging_note.trim(),
    halal_note: stall.halal_note.trim(),
    published_to_parents: Boolean(stall.published_to_parents),
    pledge_deadline: stall.pledge_deadline ? String(stall.pledge_deadline).slice(0, 10) : null,
    status: nextStatus(stall.status, { submit }),
  }
  if (allowBankDetails) {
    payload.bank_account_name = (stall.bank_account_name || '').trim()
    payload.bank_name = (stall.bank_name || '').trim()
    payload.bank_branch = (stall.bank_branch || '').trim()
    payload.bank_account_number = (stall.bank_account_number || '').trim()
    payload.bank_reference = (stall.bank_reference || '').trim()
  }
  return payload
}

export function submitGaps(stall, dishes) {
  const gaps = []
  const named = dishes.filter((dish) => dish.name.trim())
  if ((stall.support_type === 'food' || stall.support_type === 'both') && named.length === 0) {
    gaps.push('Add at least one dish, or switch the support type.')
  }
  if (stall.support_type === 'money' || stall.support_type === 'both') {
    if (!stall.amount_per_family.trim()) gaps.push('Add the amount per family.')
    if (!stall.how_to_pay.trim()) gaps.push('Add how families should pay.')
    if (!stall.payment_deadline.trim()) gaps.push('Add a payment deadline.')
  }
  if (stall.support_type === 'both' && !stall.contribution_mode) {
    gaps.push('Say whether families choose one contribution or do both.')
  }
  if (!stall.year_groups.trim()) gaps.push('Add the year group or groups for this stall.')
  if (!stall.food_coordinator_name.trim() || !stall.food_coordinator_phone.trim()) {
    gaps.push('Add the food coordinator name and phone, so parents know who to ask.')
  }
  const unmarked = named.filter((dish) => !dish.diet || !dish.taste).length
  if (unmarked === 1) gaps.push('1 dish has no diet or sweet / savoury mark.')
  if (unmarked > 1) gaps.push(`${unmarked} dishes have no diet or sweet / savoury mark.`)
  return gaps
}

export function tasteBalance(dishes) {
  const named = dishes.filter((dish) => dish.name.trim())
  const sweet = named.filter((dish) => dish.taste === 'sweet').length
  const savoury = named.filter((dish) => dish.taste === 'savoury').length
  return {
    sweet,
    savoury,
    unset: named.length - sweet - savoury,
    named: named.length,
  }
}
