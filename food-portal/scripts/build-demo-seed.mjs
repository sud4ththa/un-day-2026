import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001120000_init.sql'), 'utf8')

function sliceInsert(table) {
  const marker = `insert into public.${table}`
  const start = sql.indexOf(marker)
  if (start < 0) throw new Error(`missing insert for ${table}`)
  const valuesAt = sql.indexOf('values', start)
  const header = sql.slice(start, valuesAt)
  const columns = [...header.matchAll(/([a-z_]+)/g)].map((match) => match[1])
    .filter((name) => !['insert', 'into', 'public', table, 'values'].includes(name))
  const end = sql.indexOf(';\n', valuesAt)
  return { columns, body: sql.slice(valuesAt + 'values'.length, end) }
}

function parseTuples(body) {
  const tuples = []
  let i = 0
  const skipSpace = () => {
    while (i < body.length && /\s/.test(body[i])) i += 1
  }
  const parseValue = () => {
    skipSpace()
    if (body.startsWith('null', i)) {
      i += 4
      return null
    }
    if (body.startsWith('array[', i)) {
      i += 6
      const items = []
      skipSpace()
      if (body[i] !== ']') {
        items.push(parseValue())
        skipSpace()
        while (body[i] === ',') {
          i += 1
          items.push(parseValue())
          skipSpace()
        }
      }
      if (body[i] !== ']') throw new Error(`array at ${body.slice(i, i + 20)}`)
      i += 1
      skipCast()
      return items
    }
    if (body[i] === "'") {
      i += 1
      let text = ''
      while (i < body.length) {
        if (body[i] === "'" && body[i + 1] === "'") {
          text += "'"
          i += 2
          continue
        }
        if (body[i] === "'") {
          i += 1
          break
        }
        text += body[i]
        i += 1
      }
      if (text === '{}' && body.startsWith('::', i)) {
        skipCast()
        return []
      }
      skipCast()
      return text
    }
    const number = /^-?\d+/.exec(body.slice(i))
    if (number) {
      i += number[0].length
      return Number(number[0])
    }
    throw new Error(`bad SQL value near ${body.slice(i, i + 40)}`)
  }
  const skipCast = () => {
    if (body.startsWith('::', i)) {
      i += 2
      while (i < body.length && /[a-z\[\]]/i.test(body[i])) i += 1
    }
  }

  while (i < body.length) {
    skipSpace()
    if (i >= body.length) break
    if (body[i] !== '(') {
      i += 1
      continue
    }
    i += 1
    const values = []
    while (i < body.length) {
      skipSpace()
      if (body[i] === ')') {
        i += 1
        break
      }
      values.push(parseValue())
      skipSpace()
      if (body[i] === ',') i += 1
    }
    tuples.push(values)
  }
  return tuples
}

function rows(table) {
  const { columns, body } = sliceInsert(table)
  return parseTuples(body).map((values) => {
    if (values.length !== columns.length) {
      throw new Error(`${table} has ${values.length} values for ${columns.length} columns (${values[0]})`)
    }
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]))
  })
}

const stalls = rows('stalls').map((stall) => ({
  ...stall,
  status: 'not_started',
  locked_at: null,
  locked_by: null,
  submitted_at: null,
  updated_at: null,
  updated_by: null,
  updated_by_email: null,
}))

const dishes = rows('dishes').map((dish) => ({
  id: `${dish.stall_id}-${dish.sort_order}`,
  ...dish,
  allergens: Array.isArray(dish.allergens) ? dish.allergens : [],
}))

const out = `// Generated from supabase/migrations/20261001120000_init.sql by scripts/build-demo-seed.mjs
export const demoSeed = ${JSON.stringify({ stalls, dishes }, null, 2)}
`
fs.writeFileSync(path.join(root, 'src/lib/demoSeed.js'), out)
console.log(`stalls ${stalls.length}, dishes ${dishes.length}`)
