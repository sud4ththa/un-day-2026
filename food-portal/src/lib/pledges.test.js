import test from 'node:test'
import assert from 'node:assert/strict'
import { dishLimit, pledgeAllowed, stillNeeded, suggestedStall } from './pledges.js'

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
