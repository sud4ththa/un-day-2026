import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterDuplicates, compareDishes } from './similarity.js'

test('treats the same dish name as the same, ignoring case', () => {
  assert.equal(compareDishes('Gulab Jamun', 'Gulab jamun'), 'same')
  assert.equal(compareDishes('Bundi', 'Boondi'), 'same')
})

test('flags dishes that are the same idea on another stall', () => {
  const similar = [
    ['Samosa', 'Punjabi vegetable samosas'],
    ['Samosa', 'Samosas'],
    ['Mini Chicken Satay', 'Chicken Satay'],
    ['Chicken Shawarma', 'Mini Shawarma'],
    ['Biriyani (chicken)', 'Boneless Chicken Biryani'],
    ['Mini Pizza (chicken/veg)', 'pizza'],
    ['Donuts', 'Mini Donuts'],
    ['Spring Roll', 'Chicken Spring Rolls'],
    ['Fried Chicken Wings', 'Fried/Baked chicken wings'],
    ['Mini Cupcakes', 'Cup Cakes with SL Flag'],
    ['Dates/date cake', 'Date Cake'],
  ]
  for (const [a, b] of similar) {
    assert.ok(compareDishes(a, b), `expected a match: ${a} ~ ${b}`)
  }
})

test('does not flag unrelated dishes that only share a common word', () => {
  const distinct = [
    ['Milk Rice', 'Vege Rice Noodles'],
    ['Red bean pumpkin cake', 'Date Cake'],
    ['Sushi Roll Veg', 'Spring Roll'],
    ['Chicken meat balls', 'Chicken kebabs'],
    ['Falafel & Hummus', 'Chickpea salad'],
    ['Fried Prawns', 'Fried Chicken Wings'],
    ['Matcha Sweets/Cake', 'Other Indian sweets'],
  ]
  for (const [a, b] of distinct) {
    assert.equal(compareDishes(a, b), null, `expected no match: ${a} ~ ${b}`)
  }
})

test('clusters only across stalls', () => {
  const groups = clusterDuplicates([
    { stall_id: 'india', stall_name: 'India', dish_name: 'Samosa' },
    { stall_id: 'india', stall_name: 'India', dish_name: 'Samosa' },
    { stall_id: 'middle-east', stall_name: 'Middle East', dish_name: 'Punjabi vegetable samosas' },
    { stall_id: 'palestine-un-zone', stall_name: 'Palestine and UN Zone', dish_name: 'Samosas' },
    { stall_id: 'japan', stall_name: 'Japan', dish_name: 'Senbei Rice Crackers' },
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].stallCount, 3)
})
