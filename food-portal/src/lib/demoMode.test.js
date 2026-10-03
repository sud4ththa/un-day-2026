import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_BANNER, demoActor, demoActorOptions } from './demoMode.js'

const stalls = [
  { id: 'india', name: 'India' },
  { id: 'japan', name: 'Japan' },
]

test('banner and picker labels', () => {
  assert.equal(DEMO_BANNER, 'Demo: nothing is saved or sent.')
  assert.deepEqual(demoActorOptions(stalls).map((item) => item.label), [
    'Admin',
    'India lead',
    'Japan lead',
    'Parent',
  ])
})

test('a lead actor stays on that stall and the admin is not a lead', () => {
  assert.equal(demoActor('india', stalls).role, 'lead')
  assert.equal(demoActor('india', stalls).stall_id, 'india')
  assert.equal(demoActor('admin', stalls).role, 'admin')
  assert.equal(demoActor('parent', stalls).role, 'parent')
})
