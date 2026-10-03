import { AdminDashboard } from './screens/AdminDashboard.jsx'
import { ParentPledge } from './screens/ParentPledge.jsx'
import { PlanEditor } from './screens/PlanEditor.jsx'
import { openLeadPreview, withPreviewEditing } from './lib/leadPreview.js'

export function Portal({ profile, stallId, setStallId, preview, setPreview, onSignOut = null }) {
  if (profile.role === 'parent') {
    return <ParentPledge profile={profile} onSignOut={onSignOut} />
  }

  const isAdmin = profile.role === 'admin'
  if (isAdmin && !stallId) {
    return (
      <AdminDashboard
        profile={profile}
        onOpen={(id) => {
          setPreview(null)
          setStallId(id)
        }}
        onViewAsLead={(id) => {
          setPreview(openLeadPreview(id))
          setStallId(id)
        }}
        onSignOut={onSignOut}
      />
    )
  }

  const activePreview = isAdmin ? preview : null
  return (
    <PlanEditor
      key={`${profile.email}:${stallId || profile.stall_id}:${activePreview ? 'preview' : 'plan'}`}
      profile={profile}
      stallId={stallId || profile.stall_id}
      leadPreview={activePreview}
      onLeadPreviewEditing={(editing) => setPreview((current) => withPreviewEditing(current, editing))}
      onBack={isAdmin ? () => {
        setPreview(null)
        setStallId(null)
      } : null}
      onSignOut={onSignOut}
    />
  )
}
