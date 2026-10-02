import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dishLimit,
  formatClass,
  pledgeAllowed,
  sectionLetter,
  stallForAssignedYear,
  stallsStillNeedingFood,
  stillNeeded,
  suggestedStall,
} from './pledges.js'

test('caps a pledge at what is still needed', () => {
  assert.equal(dishLimit({ max_quantity: 40, target_pieces: 10 }), 40)
  assert.equal(dishLimit({ max_quantity: null, target_pieces: 10 }), 10)
  assert.equal(stillNeeded(40, 30), 10)
  assert.deepEqual(pledgeAllowed({ limit: 40, pledgedByOthers: 30, quantity: 10 }), { ok: true, remaining: 10 })
  assert.equal(pledgeAllowed({ limit: 40, pledgedByOthers: 30, quantity: 11 }).message, 'Only 10 still needed')
  assert.equal(pledgeAllowed({ limit: 5, pledgedByOthers: 5, quantity: 1 }).message, 'Full')
  assert.equal(pledgeAllowed({ limit: null, pledgedByOthers: 0, quantity: 1 }).ok, false)
})

test('suggests the stall for a year group without matching Year 1 to Year 10', () => {
  const stalls = [
    { id: 'india', name: 'India', year_groups: 'Year 10' },
    { id: 'sri-lanka', name: 'Sri Lanka', year_groups: 'Nursery and Year 1' },
    { id: 'palestine-un-zone', name: 'Palestine and UN Zone', year_groups: 'Year 9 and Year 13' },
  ]
  assert.equal(suggestedStall(stalls, 'Year 10').id, 'india')
  assert.equal(suggestedStall(stalls, 'Year 1').id, 'sri-lanka')
  assert.equal(suggestedStall(stalls, 'Year 13').id, 'palestine-un-zone')
  assert.equal(suggestedStall(stalls, 'Nursery').id, 'sri-lanka')
  assert.equal(suggestedStall(stalls, 'Year 11'), null)
})

test('sends a child to the stall assigned to that year', () => {
  const stalls = [
    { id: 'india', name: 'India', assigned_year_group: 'Year 1', published_to_parents: true, support_type: 'food' },
    { id: 'japan', name: 'Japan', assigned_year_group: 'Year 11', published_to_parents: false, support_type: 'food' },
    { id: 'maldives', name: 'Maldives', assigned_year_group: null, published_to_parents: true, support_type: 'food' },
  ]
  const dishes = [
    { id: 'd1', stall_id: 'india', name: 'Samosa' },
    { id: 'd2', stall_id: 'maldives', name: 'Garudhiya' },
  ]
  const remaining = [
    { dish_id: 'd1', remaining: 0 },
    { dish_id: 'd2', remaining: 4 },
  ]
  assert.equal(formatClass('Year 1', 'a'), 'Year 1 A')
  assert.equal(formatClass('Nursery', ''), 'Nursery')
  assert.equal(sectionLetter('ab'), 'AB')
  assert.equal(sectionLetter('1'), null)
  assert.equal(stallForAssignedYear(stalls, 'Year 1').id, 'india')
  assert.equal(stallForAssignedYear(stalls, 'Year 11'), null)
  assert.equal(stallForAssignedYear(stalls, 'Year 2'), null)
  assert.deepEqual(stallsStillNeedingFood(stalls, dishes, remaining).map((stall) => stall.id), ['maldives'])
})
