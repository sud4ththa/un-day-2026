import test from 'node:test'
import assert from 'node:assert/strict'
import { dishToDb, nextStatus, submitGaps } from './plan.js'

test('keeps a submitted plan submitted while editing, and drafts a new one', () => {
  assert.equal(nextStatus('not_started', { submit: false }), 'draft')
  assert.equal(nextStatus('draft', { submit: true }), 'submitted')
  assert.equal(nextStatus('submitted', { submit: false }), 'submitted')
  assert.equal(nextStatus('locked', { submit: false }), 'locked')
  assert.equal(nextStatus('locked', { submit: true }), 'submitted')
})

test('lists what is still open before submit', () => {
  const gaps = submitGaps(
    {
      support_type: 'both',
      amount_per_family: '',
      how_to_pay: '',
      payment_deadline: '',
      contribution_mode: null,
      year_groups: '',
      food_coordinator_name: '',
      food_coordinator_phone: '',
    },
    [{ name: 'Samosa', diet: null, taste: 'savoury' }],
  )
  assert.ok(gaps.some((gap) => gap.includes('amount')))
  assert.ok(gaps.some((gap) => gap.includes('choose one')))
  assert.ok(gaps.some((gap) => gap.includes('1 dish')))
})

test('money-only plans do not require a dish', () => {
  const gaps = submitGaps(
    {
      support_type: 'money',
      amount_per_family: 'LKR 5000',
      how_to_pay: 'Cash to Nimal',
      payment_deadline: '13 Oct 2026',
      contribution_mode: null,
      year_groups: 'Year 10',
      food_coordinator_name: 'Nimal',
      food_coordinator_phone: '0770000000',
    },
    [],
  )
  assert.deepEqual(gaps, [])
})

test('stores a whole number of pieces and drops anything else', () => {
  const row = dishToDb(
    {
      id: 'd1',
      stall_id: 'japan',
      name: ' Mochi ',
      diet: 'veg',
      allergens: ['other'],
      allergen_other: ' sesame ',
      spice: 'none',
      taste: 'sweet',
      made_by: 'home',
      caterer_name: 'Ignored',
      caterer_contact: '077',
      target_pieces: '40',
      notes: ' soft ',
    },
    2,
  )
  assert.equal(row.name, 'Mochi')
  assert.equal(row.target_pieces, 40)
  assert.equal(row.sort_order, 3)
  assert.equal(row.caterer_name, '')
  assert.equal(row.allergen_other, 'sesame')

  const messy = dishToDb({ ...row, target_pieces: 'about 20', allergens: [], made_by: 'caterer', caterer_name: 'Fab', caterer_contact: '077' }, 0)
  assert.equal(messy.target_pieces, null)
  assert.equal(messy.caterer_name, 'Fab')
})
