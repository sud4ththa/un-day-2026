export const DEMO_BANNER = 'Demo: nothing is saved or sent.'

export function demoActorOptions(stalls) {
  return [
    { id: 'admin', label: 'Admin' },
    ...stalls.map((stall) => ({ id: stall.id, label: `${stall.name} lead` })),
    { id: 'parent', label: 'Parent' },
  ]
}

export function demoActor(id, stalls) {
  if (id === 'parent') {
    return {
      email: 'parent@demo.local',
      role: 'parent',
      display_name: 'Parent',
      stall_id: null,
    }
  }
  const stall = stalls.find((item) => item.id === id)
  if (!stall) {
    return {
      email: 'ptc@demo.local',
      role: 'admin',
      display_name: 'PTC admin',
      stall_id: null,
    }
  }
  return {
    email: `${stall.id}@demo.local`,
    role: 'lead',
    display_name: `${stall.name} lead`,
    stall_id: stall.id,
  }
}
