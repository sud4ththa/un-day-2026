import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BANK_APPROVAL_NOTE,
  accountNumberFields,
  bankPreviewLines,
  looksLikeAccountNumber,
} from './bankDetails.js'

test('keeps the approval note exact', () => {
  assert.equal(
    BANK_APPROVAL_NOTE,
    'Collecting money into individual accounts is awaiting approval from the PTC and the school. This will open once approved.',
  )
})

test('flags account numbers and ignores phone numbers and ordinary notes', () => {
  assert.equal(looksLikeAccountNumber('Account number: 5464113'), true)
  assert.equal(looksLikeAccountNumber('1220044952'), true)
  assert.equal(looksLikeAccountNumber('WhatsApp the receipt to Chandi on 0773824465'), false)
  assert.equal(looksLikeAccountNumber('Suggested vendor from last year: Fab, via Dinusha 0776383877.'), false)
  assert.equal(looksLikeAccountNumber('Silver Aisle bakery, 077 510 2583.'), false)
  assert.equal(looksLikeAccountNumber('Heavenly Bakes, Zeenath 777259249.'), false)
  assert.equal(looksLikeAccountNumber('LKR 5,000'), false)
  assert.equal(looksLikeAccountNumber('Tuesday 6 October 2026'), false)
  assert.equal(looksLikeAccountNumber(''), false)
})

test('hides bank lines until the PTC allows them', () => {
  const stall = {
    how_to_pay: 'WhatsApp the receipt to Chandi on 0773824465',
    bank_account_name: 'L C Kumari',
    bank_name: 'BOC',
    bank_branch: 'Rajagiriya',
    bank_account_number: '5464113',
    bank_reference: "Child's name and class",
  }
  assert.deepEqual(bankPreviewLines(stall, false), [])
  assert.deepEqual(bankPreviewLines(stall, true), [
    'Account name: L C Kumari',
    'Bank: BOC, Rajagiriya branch',
    'Account number: 5464113',
    'Reference: Child\'s name and class',
  ])
  assert.deepEqual(accountNumberFields(stall, []), [])
  assert.deepEqual(
    accountNumberFields({ how_to_pay: 'Please use account 5464113' }, [{ name: 'Samosa', notes: '' }]),
    ['How to pay'],
  )
})
