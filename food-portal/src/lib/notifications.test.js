import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNotificationPreviews,
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationSettings,
  parseRecipients,
} from './notifications.js'

test('notification switches start off and no addresses are invented', () => {
  const settings = notificationSettings(null)
  assert.equal(settings.parent_reminders, false)
  assert.equal(settings.daily_stall_update, false)
  assert.equal(settings.daily_admin_report, false)
  assert.equal(settings.progress_report, false)
  assert.equal(settings.progress_recipients, '')
  assert.equal(settings.event_date, '2026-10-16')
  assert.deepEqual(parseRecipients('  \n not-an-email '), [])
  assert.deepEqual(parseRecipients('Ada@School.org, ada@school.org'), ['ada@school.org'])
  const preview = buildNotificationPreviews({
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    stalls: [{ id: 'japan', name: 'Japan', assigned_year_group: 'Year 11' }],
    dishes: [{ id: 'j1', stall_id: 'japan', name: 'Sushi', max_quantity: 40 }],
    contacts: [{ stall_id: 'japan', role: 'lead', email: 'kenji@example.com', display_name: 'Kenji' }],
    now: new Date('2026-10-02T02:00:00Z'),
  })
  assert.equal(preview.messages.length, 5)
  assert.match(preview.messages[0].body, /The PTC/)
  assert.doesNotMatch(preview.messages[4].body, /@/)
  assert.equal(preview.messages[4].to, 'No addresses yet')
  assert.match(preview.messages[2].body, /kenji@example.com/)
  assert.match(preview.messages[2].body, /40 still needed/)
  assert.match(preview.messages[4].body, /1 dish is still short/)
})
