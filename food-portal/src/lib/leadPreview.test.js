import test from 'node:test'
import assert from 'node:assert/strict'
import {
  leadPreviewBanner,
  leadPreviewState,
  openLeadPreview,
  previewEditEmail,
  withPreviewEditing,
} from './leadPreview.js'

test('names the stall in the preview banner', () => {
  assert.equal(leadPreviewBanner('India'), 'Viewing as India lead (admin preview)')
})

test('starts read-only and keeps the edit on the admin email', () => {
  const preview = openLeadPreview('india')
  assert.deepEqual(leadPreviewState(preview), { active: true, editing: false, readOnly: true })
  const editing = withPreviewEditing(preview, true)
  assert.equal(leadPreviewState(editing).readOnly, false)
  assert.equal(editing.stallId, 'india')
  const admin = { email: 'Subraja.Subramaniam@pta.britishschool.lk', role: 'admin' }
  assert.equal(previewEditEmail(admin), 'subraja.subramaniam@pta.britishschool.lk')
})
