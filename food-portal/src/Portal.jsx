import { AdminDashboard } from './screens/AdminDashboard.jsx'
import { ParentPledge } from './screens/ParentPledge.jsx'
import { PlanEditor } from './screens/PlanEditor.jsx'

export function Portal({ profile, stallId, setStallId, onSignOut = null }) {
  if (profile.role === 'parent') {
    return <ParentPledge profile={profile} onSignOut={onSignOut} />
  }

  if (!stallId) {
    return (
      <AdminDashboard
        profile={profile}
        onOpen={(id) => setStallId(id)}
        onSignOut={onSignOut}
      />
    )
  }

  return (
    <PlanEditor
      key={`${profile.email}:${stallId}`}
      profile={profile}
      stallId={stallId}
      onBack={() => setStallId(null)}
      onSignOut={onSignOut}
    />
  )
}
