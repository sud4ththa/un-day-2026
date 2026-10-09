export function leadPreviewBanner(stallName) {
  return `Viewing as ${stallName} lead (admin preview)`
}

export function openLeadPreview(stallId) {
  return { stallId, editing: false }
}

export function withPreviewEditing(preview, editing) {
  if (!preview) return preview
  return { ...preview, editing: Boolean(editing) }
}

export function leadPreviewState(preview) {
  const active = Boolean(preview)
  const editing = active && preview.editing === true
  return {
    active,
    editing,
    readOnly: active && !editing,
  }
}

// Preview never swaps the signed-in person. Edits stay on the admin's email.
export function previewEditEmail(profile) {
  return (profile?.email || '').toLowerCase()
}
