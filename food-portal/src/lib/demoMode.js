export const DEMO_BANNER = 'Demo: nothing is saved or sent.'

export function demoActorOptions() {
  return [
    { id: 'admin', label: 'Admin' },
    { id: 'parent', label: 'Parent' },
  ]
}

export function demoActor(id) {
  if (id === 'parent') {
    return {
      email: 'parent@demo.local',
      role: 'parent',
      display_name: 'Parent',
      stall_id: null,
      user_id: 'demo-parent',
    }
  }
  return {
    email: 'ptc@demo.local',
    role: 'admin',
    display_name: 'PTC admin',
    stall_id: null,
  }
}
