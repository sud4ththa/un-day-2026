const STOP = new Set([
  'mini', 'with', 'and', 'the', 'for', 'from', 'per', 'pack', 'pcs', 'piece',
  'pieces', 'small', 'large', 'style', 'please', 'keep', 'any', 'other',
  'item', 'items', 'cut', 'into', 'veg', 'vegetable', 'vegetarian', 'chicken',
  'halal', 'homemade', 'home', 'made', 'size', 'sized', 'sample', 'non',
])

// These words are too common to mean "same dish" on their own, but two of
// them together (fried + wing, spring + roll) still counts.
const GENERIC = new Set([
  'fried', 'baked', 'grilled', 'roast', 'roasted', 'spicy', 'wing', 'rice',
  'cake', 'roll', 'sweet', 'chip', 'bun', 'pie', 'noodle', 'cookie', 'bread',
  'salad', 'sauce', 'curry', 'fruit', 'milk', 'coconut', 'cheese', 'fish',
  'meat', 'ball', 'tart', 'egg', 'pork', 'beef', 'lamb', 'white', 'red',
  'green', 'mini',
])

export function normaliseName(name) {
  let s = String(name || '').toLowerCase()
  s = s.replace(/\([^)]*\)/g, ' ')
  s = s.replace(/&/g, ' and ')
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/\bbiriyani\b/g, 'biryani')
  s = s.replace(/\bdoughnuts?\b/g, 'donut')
  s = s.replace(/\bdonuts\b/g, 'donut')
  s = s.replace(/\bladdoos\b/g, 'laddoo')
  s = s.replace(/\bcup cakes\b/g, 'cupcake')
  s = s.replace(/\bcupcakes\b/g, 'cupcake')
  s = s.replace(/\bbundi\b/g, 'boondi')
  return s
}

function stem(token) {
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1)
  }
  return token
}

function contentTokens(name) {
  return normaliseName(name)
    .split(' ')
    .filter((token) => token && token.length >= 3 && !STOP.has(token))
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP.has(token))
}

export function compareDishes(a, b) {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (!left || !right) return null
  if (left === right) return 'same'

  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length >= 5 && longer.includes(shorter)) return 'similar'

  const ta = contentTokens(a)
  const tb = contentTokens(b)
  const setB = new Set(tb)
  const shared = ta.filter((token) => setB.has(token))
  const uniqueShared = [...new Set(shared)]
  if (uniqueShared.length >= 2) return 'similar'
  if (uniqueShared.some((token) => !GENERIC.has(token) && token.length >= 4)) {
    return 'similar'
  }
  return null
}

export function findSimilar(name, index, ownStallId) {
  if (!name || name.trim().length < 2) return []
  const hits = []
  const seen = new Set()
  for (const row of index) {
    if (row.stall_id === ownStallId) continue
    const kind = compareDishes(name, row.dish_name)
    if (!kind) continue
    const key = `${row.stall_id}:${normaliseName(row.dish_name)}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({ ...row, kind })
  }
  const rank = { same: 0, similar: 1 }
  hits.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.stall_name.localeCompare(b.stall_name),
  )
  return hits
}

export function clusterDuplicates(rows) {
  const parent = rows.map((_, index) => index)
  const find = (index) => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]]
      cursor = parent[cursor]
    }
    return cursor
  }
  const union = (a, b) => {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent[pa] = pb
  }

  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i].dish_name || !rows[i].dish_name.trim()) continue
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].stall_id === rows[j].stall_id) continue
      if (!rows[j].dish_name || !rows[j].dish_name.trim()) continue
      if (compareDishes(rows[i].dish_name, rows[j].dish_name)) union(i, j)
    }
  }

  const groups = new Map()
  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i].dish_name || !rows[i].dish_name.trim()) continue
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(rows[i])
  }

  return [...groups.values()]
    .map((members) => ({
      members,
      stallCount: new Set(members.map((member) => member.stall_id)).size,
    }))
    .filter((group) => group.stallCount >= 2)
    .sort((a, b) => b.stallCount - a.stallCount || a.members[0].dish_name.localeCompare(b.members[0].dish_name))
}
