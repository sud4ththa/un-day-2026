import { useState } from 'react'
import { setDemoActor } from './lib/demoClient.js'
import { DEMO_BANNER, demoActor, demoActorOptions } from './lib/demoMode.js'
import { Portal } from './Portal.jsx'

export function DemoApp({ initialActor = 'admin' }) {
  const [actorId, setActorId] = useState(initialActor)
  const [stallId, setStallId] = useState(null)
  const actor = demoActor(actorId)
  setDemoActor(actor)

  function pick(id) {
    setActorId(id)
    setStallId(null)
  }

  return (
    <>
      <div className="demo-bar">
        <p role="status">{DEMO_BANNER}</p>
        <label className="demo-pick">
          <span>Try as</span>
          <select aria-label="Try as" value={actorId} onChange={(event) => pick(event.target.value)}>
            {demoActorOptions().map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <Portal
        profile={actor}
        stallId={stallId}
        setStallId={setStallId}
      />
    </>
  )
}
