import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv, toJson } from './export.js'

const stalls = [
  {
    id: 'eco-warriors',
    name: 'Eco Warriors',
    status: 'not_started',
    year_groups: 'Year 8',
    support_type: 'food',
    amount_per_family: '',
    how_to_pay: '',
    payment_deadline: '',
    contribution_mode: null,
    food_coordinator_name: '',
    food_coordinator_phone: '',
    dropoff_instructions: '',
    packaging_note: 'No single-use plastic.',
    halal_note: '',
    submitted_at: null,
    locked_at: null,
    updated_at: null,
    updated_by_email: null,
  },
  {
    id: 'india',
    name: 'India',
    status: 'draft',
    year_groups: 'Year 10',
    support_type: 'both',
    amount_per_family: 'LKR 5,000',
    how_to_pay: 'Bank',
    payment_deadline: '13 Oct',
    contribution_mode: 'either',
    food_coordinator_name: 'Nimal',
    food_coordinator_phone: '077',
    dropoff_instructions: '',
    packaging_note: 'No single-use plastic.',
    halal_note: '',
    submitted_at: null,
    locked_at: null,
    updated_at: '2026-10-02T08:00:00Z',
    updated_by_email: 'lead@example.com',
  },
]

test('writes one row per dish and a summary row when a stall has none', () => {
  const csv = toCsv(stalls, [
    {
      stall_id: 'india',
      name: 'Say "hello"',
      diet: 'veg',
      allergens: ['nuts', 'dairy'],
      allergen_other: '',
      spice: 'mild',
      taste: 'savoury',
      made_by: 'home',
      caterer_name: '',
      caterer_contact: '',
      target_pieces: 20,
      notes: '=cmd',
      sort_order: 1,
    },
  ])
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /assigned_year_group/)
  assert.match(lines[1], /Eco Warriors/)
  assert.match(lines[2], /Say ""hello""/)
  assert.match(lines[2], /nuts\|dairy/)
  assert.match(lines[2], /"'=cmd"/)
})

test('nests dishes under each stall in JSON', () => {
  const json = toJson(stalls, [
    {
      stall_id: 'india',
      name: 'Samosa',
      diet: 'veg',
      allergens: [],
      allergen_other: '',
      spice: null,
      taste: 'savoury',
      made_by: 'home',
      caterer_name: '',
      caterer_contact: '',
      target_pieces: null,
      notes: '',
      sort_order: 1,
    },
  ])
  assert.equal(json.stalls[0].dishes.length, 0)
  assert.equal(json.stalls[1].dishes[0].dish_name, 'Samosa')
  assert.equal(json.event, 'UN Day 2026')
})
