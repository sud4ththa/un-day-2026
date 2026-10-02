import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_BANNER, demoActor, demoActorOptions } from './demoMode.js'

test('banner and picker labels', () => {
  assert.equal(DEMO_BANNER, 'Demo: nothing is saved or sent.')
  assert.deepEqual(demoActorOptions().map((item) => item.label), ['Admin', 'Parent'])
})

test('the demo signs in as the PTC or as a parent', () => {
  assert.equal(demoActor('admin').role, 'admin')
  assert.equal(demoActor('parent').role, 'parent')
  assert.equal(demoActor('japan').role, 'admin')
})
