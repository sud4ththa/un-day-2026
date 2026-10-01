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
  if (error?.code === '23505') return 'That email is already on the list.'
  if (/must be assigned/i.test(msg)) return 'Choose a stall for this lead.'
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
