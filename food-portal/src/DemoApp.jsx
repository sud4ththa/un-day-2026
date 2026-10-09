import { useState } from 'react'
import { setDemoActor } from './lib/demoClient.js'
import { DEMO_BANNER, demoActor, demoActorOptions } from './lib/demoMode.js'
import { demoSeed } from './lib/demoSeed.js'
import { Portal } from './Portal.jsx'

export function DemoApp({ initialActor = 'admin' }) {
  const [actorId, setActorId] = useState(initialActor)
  const [stallId, setStallId] = useState(null)
  const [preview, setPreview] = useState(null)
  const actor = demoActor(actorId, demoSeed.stalls)
  setDemoActor(actor)

  function pick(id) {
    setActorId(id)
    setPreview(null)
    setStallId(id === 'admin' || id === 'parent' ? null : id)
  }

  return (
    <>
      <div className="demo-bar">
        <p role="status">{DEMO_BANNER}</p>
        <label className="demo-pick">
          <span>Try as</span>
          <select aria-label="Try as" value={actorId} onChange={(event) => pick(event.target.value)}>
            {demoActorOptions(demoSeed.stalls).map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <Portal
        profile={actor}
        stallId={stallId}
        setStallId={setStallId}
        preview={preview}
        setPreview={setPreview}
      />
    </>
  )
}
