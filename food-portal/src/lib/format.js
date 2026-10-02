export function formatWhen(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function friendlySendError(error) {
  const msg = (error?.message || '').toLowerCase()
  if (
    msg.includes('not on the un day')
    || msg.includes('not on the list')
    || msg.includes('signups not allowed')
    || msg.includes('user not found')
    || msg.includes('signups are disabled')
    || msg.includes('database error saving')
  ) {
    return 'This email is not on the list yet. Ask the PTC to add you.'
  }
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('over_email')) {
    return 'Too many codes were sent just now. Wait a few minutes and try again.'
  }
  return 'The code could not be sent. Try again in a moment.'
}

export function friendlyVerifyError(error) {
  const msg = (error?.message || '').toLowerCase()
  if (msg.includes('expired')) return 'That code has expired. Request a new one.'
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.'
  }
  return 'That code did not work. Check the email and try again.'
}

export function friendlySaveError(error) {
  const msg = error?.message || ''
  if (/locked/i.test(msg)) return 'The PTC has locked this stall, so this change was not saved.'
  if (/row-level security/i.test(msg) || error?.code === '42501') return 'This change was not allowed.'
  if (/at least one admin/i.test(msg)) return 'The list needs at least one admin.'
  if (/already has a lead/i.test(msg)) return 'This stall already has a lead. Replace them instead.'
  if (/already has a food coordinator/i.test(msg)) return 'This stall already has a food coordinator. Replace them instead.'
  if (/one_slot_per_stall/i.test(msg)) return 'This stall already has someone in that slot. Replace them instead.'
  if (error?.code === '23505') return 'That email is already on the list.'
  if (/must be assigned/i.test(msg)) return 'Choose a stall for this lead.'
  if (/still needed/i.test(msg)) return msg.replace(/^.*?(Only \d+ still needed).*$/i, '$1')
  if (/^full$/i.test(msg.trim()) || /\bfull\b/i.test(msg) && /pledge|dish/i.test(msg)) return 'That dish is full.'
  if (msg.trim() === 'Full') return 'That dish is full.'
  if (/deadline has passed/i.test(msg)) return 'The pledge deadline has passed.'
  if (/not open for pledges/i.test(msg)) return 'This stall is not open for pledges yet.'
  if (/no limit yet/i.test(msg)) return 'This dish has no limit yet.'
  if (/not collecting money/i.test(msg)) return 'This stall is not collecting money.'
  if (/reason is required/i.test(msg)) return 'Add a reason.'
  if (/only the ptc can remove/i.test(msg)) return 'Only the PTC can remove a pledge.'
  return 'Could not save. Check your connection and try again.'
}

const DIET_LABEL = { veg: 'Vegetarian', non_veg: 'Non-vegetarian', vegan: 'Vegan' }
const SPICE_LABEL = { none: 'No spice', mild: 'Mild', medium: 'Medium', hot: 'Hot' }
const TASTE_LABEL = { sweet: 'Sweet', savoury: 'Savoury' }
const ALLERGEN_LABEL = {
  nuts: 'nuts',
  dairy: 'dairy',
  gluten: 'gluten',
  egg: 'egg',
  seafood: 'seafood',
}

export function dietLabel(value) {
  return DIET_LABEL[value] || ''
}

export function spiceLabel(value) {
  return SPICE_LABEL[value] || ''
}

export function tasteLabel(value) {
  return TASTE_LABEL[value] || ''
}

export function allergenList(dish) {
  const labels = (dish.allergens || [])
    .filter((key) => key !== 'other')
    .map((key) => ALLERGEN_LABEL[key] || key)
  if ((dish.allergens || []).includes('other') && dish.allergen_other.trim()) {
    labels.push(dish.allergen_other.trim())
  } else if ((dish.allergens || []).includes('other')) {
    labels.push('other')
  }
  return labels
}
