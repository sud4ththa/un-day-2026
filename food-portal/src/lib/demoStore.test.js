import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoClient, createMemoryStorage, freshDemoState } from './demoStore.js'

const seed = {
  stalls: [
    {
      id: 'japan',
      name: 'Japan',
      sort_order: 1,
      status: 'not_started',
      year_groups: 'Year 5',
      support_type: 'food',
      how_to_pay: '',
      bank_account_number: '',
      updated_by_email: null,
    },
    {
      id: 'india',
      name: 'India',
      sort_order: 2,
      status: 'not_started',
      year_groups: 'Year 10',
      support_type: 'both',
      how_to_pay: 'WhatsApp Chandi',
      bank_account_name: 'L C Kumari',
      bank_account_number: '5464113',
      updated_by_email: null,
    },
  ],
  dishes: [
    { id: 'india-1', stall_id: 'india', name: 'Samosa', sort_order: 1 },
    { id: 'japan-1', stall_id: 'japan', name: 'Sushi', sort_order: 1 },
  ],
}

const admin = { email: 'ptc@demo.local', role: 'admin', display_name: 'PTC admin', stall_id: null }
const japanLead = { email: 'japan@demo.local', role: 'lead', display_name: 'Japan lead', stall_id: 'japan' }

function clientAs(actor) {
  let current = actor
  const storage = createMemoryStorage()
  const client = createDemoClient({
    storage,
    seed,
    getActor: () => current,
  })
  return {
    client,
    setActor(next) {
      current = next
    },
  }
}

test('bank details start off and a stall contact cannot turn them on', async () => {
  const { client, setActor } = clientAs(admin)
  const first = await client.from('portal_settings').select('*').single()
  assert.equal(first.data.allow_bank_details, false)
  const notes = await client.from('notification_settings').select('parent_reminders').single()
  assert.equal(notes.data.parent_reminders, false)
  setActor(japanLead)
  const blocked = await client.from('portal_settings').update({ allow_bank_details: true }).eq('id', 'portal')
  assert.match(blocked.error.message, /row-level security/)
  setActor(admin)
  const still = await client.from('portal_settings').select('allow_bank_details').single()
  assert.equal(still.data.allow_bank_details, false)
})

test('a stall contact cannot open a plan, and an admin edit is attributed to the admin', async () => {
  const { client, setActor } = clientAs(japanLead)
  const stalls = await client.from('stalls').select('*')
  assert.deepEqual(stalls.data, [])
  const hidden = await client.from('dishes').select('*').eq('stall_id', 'india')
  assert.equal(hidden.data.length, 0)
  const blocked = await client.from('stalls').update({ year_groups: 'Hacked' }).eq('id', 'india')
  assert.ok(blocked.error)
  const own = await client.from('stalls').update({ year_groups: 'Year 5' }).eq('id', 'japan')
  assert.ok(own.error)

  setActor(admin)
  const saved = await client.from('stalls').update({ dropoff_instructions: 'Gate' }).eq('id', 'india').select('updated_by_email').single()
  assert.equal(saved.data.updated_by_email, 'ptc@demo.local')
  const india = freshDemoState(seed).stalls[1]
  assert.equal(india.bank_account_number, '5464113')
})

test('two parents cannot pledge more than the dish still needs', async () => {
  const { client, setActor } = clientAs({
    email: 'parent@demo.local',
    role: 'parent',
    user_id: 'demo-parent',
    stall_id: null,
  })
  const first = await client.from('pledges').insert({
    stall_id: 'india',
    dish_id: 'india-1',
    quantity: 30,
    kind: 'food',
  }).select('id').single()
  assert.equal(first.error, null)

  setActor({ email: 'bea@parent.test', role: 'parent', user_id: 'parent-bea', stall_id: null })
  const created = await client.from('parents').insert({
    parent_name: 'Bea',
    child_name: 'B',
    year_group: 'Year 10',
    phone: '0772222222',
  }).select('id').single()
  assert.equal(created.error, null)
  const over = await client.from('pledges').insert({
    stall_id: 'india',
    dish_id: 'india-1',
    quantity: 11,
    kind: 'food',
  })
  assert.match(over.error.message, /Only 10 still needed/)
  const own = await client.from('pledges').select('*')
  assert.equal(own.data.length, 0)
  const stalls = await client.from('stalls').select('id')
  assert.deepEqual(stalls.data.map((stall) => stall.id).sort(), ['india', 'japan'])
})

test('a stall has one lead contact, and that person cannot sign in', async () => {
  const { client, setActor } = clientAs(admin)
  const india = await client.from('stalls').select('assigned_year_group').eq('id', 'india').single()
  assert.equal(india.data.assigned_year_group, 'Year 1')
  const japan = await client.from('stalls').select('assigned_year_group').eq('id', 'japan').single()
  assert.equal(japan.data.assigned_year_group, 'Year 11')

  const signIn = await client.from('allowlist').insert({
    email: 'a@example.com',
    role: 'lead',
    stall_id: 'japan',
    display_name: 'A',
    phone: '0771111111',
  })
  assert.match(signIn.error.message, /Only PTC admins can sign in/)

  const first = await client.from('stall_contacts').insert({
    email: 'a@example.com',
    role: 'lead',
    stall_id: 'japan',
    display_name: 'A',
    phone: '0771111111',
  }).select('phone').single()
  assert.equal(first.data.phone, '0771111111')
  const second = await client.from('stall_contacts').insert({
    email: 'b@example.com',
    role: 'lead',
    stall_id: 'japan',
    display_name: 'B',
  })
  assert.match(second.error.message, /already has a lead/)
  const coord = await client.from('stall_contacts').insert({
    email: 'c@example.com',
    role: 'food_coordinator',
    stall_id: 'japan',
    display_name: 'C',
    phone: '0772222222',
  }).select('phone').single()
  assert.equal(coord.data.phone, '0772222222')
  setActor({ email: 'c@example.com', role: 'food_coordinator', stall_id: 'japan', display_name: 'C' })
  const visible = await client.from('stalls').select('id')
  assert.deepEqual(visible.data, [])
  const names = await client.from('stall_contacts').select('email')
  assert.deepEqual(names.data, [])
})
