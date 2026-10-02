import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNED_YEAR_GROUPS, DEMO_ASSIGNED_YEAR_GROUPS } from './yearGroups.js'

test('year groups run from Nursery and Reception through Year 11', () => {
  assert.deepEqual(ASSIGNED_YEAR_GROUPS.slice(0, 4), ['Nursery', 'Reception', 'Year 1', 'Year 2'])
  assert.equal(ASSIGNED_YEAR_GROUPS.at(-1), 'Year 11')
  assert.equal(ASSIGNED_YEAR_GROUPS.includes('Playgroup'), false)
  assert.equal(ASSIGNED_YEAR_GROUPS.includes('Year 12'), false)
  assert.equal(ASSIGNED_YEAR_GROUPS.length, 13)
})

test('demo recommendations only fill the stalls that were named', () => {
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS.india, 'Year 1')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS.europe, 'Year 3')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS['sri-lanka'], 'Year 4')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS.china, 'Year 6')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS['usa-canada'], 'Year 8')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS['singapore-malaysia-thailand'], 'Year 9')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS.japan, 'Year 11')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS['middle-east'], 'Reception')
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS['eco-warriors'], undefined)
  assert.equal(DEMO_ASSIGNED_YEAR_GROUPS.maldives, undefined)
  assert.equal(Object.keys(DEMO_ASSIGNED_YEAR_GROUPS).length, 8)
})
