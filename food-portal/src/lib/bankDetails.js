export const BANK_APPROVAL_NOTE =
  'Collecting money into individual accounts is awaiting approval from the PTC and the school. This will open once approved.'

export const BANK_KEYS = [
  'bank_account_name',
  'bank_name',
  'bank_branch',
  'bank_account_number',
  'bank_reference',
]

const ACCOUNT_PHRASE = /\b(account\s*(number|no\.?|#)|a\/c(\s*(no\.?|number))?|acct(\s*(no\.?|number))?)\b/i

function isPhone(digits) {
  return /^0\d{9}$/.test(digits) || /^94\d{9}$/.test(digits) || /^7\d{8}$/.test(digits)
}

export function looksLikeAccountNumber(text) {
  const value = String(text || '')
  if (ACCOUNT_PHRASE.test(value)) return true
  const chunks = value.match(/\d(?:[\d\s-]{0,22}\d)?/g) || []
  return chunks.some((chunk) => {
    const digits = chunk.replace(/\D/g, '')
    return digits.length >= 7 && digits.length <= 18 && !isPhone(digits)
  })
}

export function accountNumberFields(stall, dishes) {
  const pairs = [
    ['How to pay', stall?.how_to_pay],
    ['Amount per family', stall?.amount_per_family],
    ['Deadline', stall?.payment_deadline],
    ['Drop-off', stall?.dropoff_instructions],
    ['Packaging', stall?.packaging_note],
    ['Halal note', stall?.halal_note],
    ['Food coordinator', stall?.food_coordinator_name],
    ['Coordinator phone', stall?.food_coordinator_phone],
  ]
  const hits = []
  for (const [label, text] of pairs) {
    if (looksLikeAccountNumber(text)) hits.push(label)
  }
  for (const dish of dishes || []) {
    if (looksLikeAccountNumber(dish?.notes)) {
      hits.push(dish.name ? `Notes on ${dish.name}` : 'Dish notes')
    }
  }
  return hits
}

export function bankPreviewLines(stall, allowBankDetails) {
  if (!allowBankDetails || !stall) return []
  const lines = []
  const name = (stall.bank_account_name || '').trim()
  const bank = (stall.bank_name || '').trim()
  const branch = (stall.bank_branch || '').trim()
  const number = (stall.bank_account_number || '').trim()
  const reference = (stall.bank_reference || '').trim()
  if (name) lines.push(`Account name: ${name}`)
  if (bank || branch) {
    lines.push(`Bank: ${[bank, branch ? `${branch} branch` : ''].filter(Boolean).join(', ')}`)
  }
  if (number) lines.push(`Account number: ${number}`)
  if (reference) lines.push(`Reference: ${reference}`)
  return lines
}
