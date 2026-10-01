import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const demo = path.join(root, 'food-demo')
fs.mkdirSync(path.join(demo, 'pledge'), { recursive: true })
fs.copyFileSync(path.join(demo, 'index.html'), path.join(demo, 'pledge', 'index.html'))
