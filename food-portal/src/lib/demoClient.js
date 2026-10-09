import { createDemoClient, createMemoryStorage } from './demoStore.js'
import { demoActor } from './demoMode.js'
import { demoSeed } from './demoSeed.js'

let actor = demoActor('admin', demoSeed.stalls)

export function setDemoActor(next) {
  actor = next
}

const storage = typeof localStorage === 'undefined' ? createMemoryStorage() : localStorage

export const demoSupabase = createDemoClient({
  storage,
  getActor: () => actor,
  seed: demoSeed,
})
