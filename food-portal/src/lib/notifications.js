import { pledgeCsv } from './pledges.js'

export const DEFAULT_NOTIFICATION_SETTINGS = {
  id: 'portal',
  parent_reminders: false,
  daily_stall_update: false,
  daily_admin_report: false,
  progress_report: false,
  progress_schedule: 'weekly',
  progress_recipients: '',
  event_date: '2026-10-16',
}

export const PROGRESS_SCHEDULES = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'daily', label: 'Every day' },
]

const TOGGLES = ['parent_reminders', 'daily_stall_update', 'daily_admin_report', 'progress_report']

export function notificationSettings(row) {
  const next = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(row || {}) }
  for (const key of TOGGLES) next[key] = Boolean(next[key])
  if (next.progress_schedule !== 'daily') next.progress_schedule = 'weekly'
  next.progress_recipients = String(next.progress_recipients || '')
  next.event_date = String(next.event_date || DEFAULT_NOTIFICATION_SETTINGS.event_date).slice(0, 10)
  return next
}

export function parseRecipients(text) {
  return [...new Set(
    String(text || '')
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.includes('@') && !item.startsWith('@')),
  )]
}

function colomboDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now)
}

function dayBefore(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function longDate(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function contactEmails(contacts, stallId) {
  return (contacts || [])
    .filter((person) => person.stall_id === stallId && person.email)
    .map((person) => person.email)
}

function pledgeLines(pledges, dishes, stallId) {
  return (pledges || [])
    .filter((pledge) => pledge.status === 'active' && (!stallId || pledge.stall_id === stallId))
    .map((pledge) => {
      if (pledge.kind === 'money') return `Money · LKR ${pledge.money_lkr}`
      const dish = (dishes || []).find((item) => item.id === pledge.dish_id)
      return `${dish?.name || 'Dish'} · ${pledge.quantity}`
    })
}

function dishGaps(stall, dishes, pledges) {
  return (dishes || [])
    .filter((dish) => dish.stall_id === stall.id && String(dish.name || '').trim())
    .map((dish) => {
      const cap = dish.max_quantity ?? dish.target_pieces
      const pledged = (pledges || [])
        .filter((pledge) => pledge.dish_id === dish.id && pledge.kind === 'food' && pledge.status === 'active')
        .reduce((sum, pledge) => sum + Number(pledge.quantity || 0), 0)
      const limit = cap == null || cap === '' ? null : Number(cap)
      const still = limit == null ? null : Math.max(0, limit - pledged)
      return { name: dish.name, pledged, limit, still }
    })
}

function sinceYesterday(pledge, now) {
  if (!pledge.created_at) return false
  const yesterday = dayBefore(colomboDay(now))
  return String(pledge.created_at).slice(0, 10) >= yesterday
}

export function buildNotificationPreviews({
  stalls = [],
  dishes = [],
  pledges = [],
  parents = [],
  contacts = [],
  admins = [],
  settings,
  now = new Date(),
}) {
  const config = notificationSettings(settings)
  const event = config.event_date
  const eve = dayBefore(event)
  const active = (pledges || []).filter((pledge) => pledge.status === 'active')
  const parentIds = new Set(active.map((pledge) => pledge.parent_id))
  const sampleParent = (parents || []).find((parent) => parentIds.has(parent.id))
  const samplePledges = sampleParent
    ? active.filter((pledge) => pledge.parent_id === sampleParent.id)
    : []
  const sampleStall = (stalls || []).find((stall) => samplePledges.some((pledge) => pledge.stall_id === stall.id))
  const parentBody = sampleParent
    ? [
      'Hello,',
      '',
      `You pledged for ${sampleStall?.name || 'your stall'}.`,
      ...pledgeLines(samplePledges, dishes),
      '',
      'The PTC',
    ].join('\n')
    : [
      'Hello,',
      '',
      'This goes to each parent who has an active pledge.',
      'There are no pledges yet, so there is nothing to send.',
      '',
      'The PTC',
    ].join('\n')

  const stallBlocks = (stalls || []).map((stall) => {
    const gaps = dishGaps(stall, dishes, pledges)
    const fresh = active.filter((pledge) => pledge.stall_id === stall.id && sinceYesterday(pledge, now))
    const lines = [
      stall.name,
      '',
      'Pledged so far',
      ...(gaps.length
        ? gaps.map((dish) => (
          dish.limit == null
            ? `${dish.name} · ${dish.pledged} pledged · no cap yet`
            : `${dish.name} · ${dish.pledged} of ${dish.limit} · ${dish.still} still needed`
        ))
        : ['No dishes yet']),
      '',
      'New since yesterday',
      ...(fresh.length ? pledgeLines(fresh, dishes) : ['None']),
    ]
    return {
      stall: stall.name,
      to: contactEmails(contacts, stall.id),
      text: lines.join('\n'),
    }
  })

  const stallSummaries = (stalls || []).map((stall) => {
    const gaps = dishGaps(stall, dishes, pledges)
    const pledged = gaps.reduce((sum, dish) => sum + dish.pledged, 0)
    const shortDishes = gaps.filter((dish) => dish.still > 0).length
    return { pledged, shortDishes, line: `${stall.name} · ${stall.assigned_year_group || 'Year group not set'} · ${pledged} pledged · ${shortDishes} ${shortDishes === 1 ? 'dish' : 'dishes'} still short` }
  })
  const short = stallSummaries.map((item) => item.line)
  const dishesStillShort = stallSummaries.reduce((sum, item) => sum + item.shortDishes, 0)
  const csv = pledgeCsv([])
  const reportCsv = pledgeCsv(active.map((pledge) => {
    const parent = (parents || []).find((item) => item.id === pledge.parent_id) || {}
    const stall = (stalls || []).find((item) => item.id === pledge.stall_id)
    const dish = (dishes || []).find((item) => item.id === pledge.dish_id)
    return {
      stall: stall?.name || pledge.stall_id,
      parent_name: parent.parent_name || '',
      child_name: parent.child_name || '',
      year_group: parent.year_group || '',
      phone: parent.phone || '',
      email: parent.email || '',
      dish: pledge.kind === 'money' ? 'Money' : (dish?.name || ''),
      quantity: pledge.kind === 'food' ? pledge.quantity : '',
      money_lkr: pledge.kind === 'money' ? pledge.money_lkr : '',
      status: pledge.status,
      removed_reason: pledge.removed_reason || '',
    }
  }))

  const recipients = parseRecipients(config.progress_recipients)
  const stallsShort = short.filter((line) => !line.includes('· 0 pledged · 0 dishes still short'))
  const progressBody = [
    'UN Day 2026',
    '',
    `Food plans for ${longDate(event)}.`,
    `${parentIds.size} ${parentIds.size === 1 ? 'family has' : 'families have'} an active pledge.`,
    `${dishesStillShort} ${dishesStillShort === 1 ? 'dish is' : 'dishes are'} still short.`,
    '',
    'This is a short progress note for the Principal and the Parent Collective.',
    '',
    'The PTC',
  ].join('\n')

  return {
    settings: config,
    messages: [
      {
        id: 'parent_eve',
        title: 'Parent reminder, the day before',
        toggle: 'parent_reminders',
        to: `${parentIds.size} ${parentIds.size === 1 ? 'parent' : 'parents'} with a pledge`,
        subject: `UN Day food tomorrow, ${longDate(eve)}`,
        body: [`UN Day is tomorrow, ${longDate(event)}.`, '', parentBody].join('\n'),
      },
      {
        id: 'parent_morning',
        title: 'Parent reminder, the morning of',
        toggle: 'parent_reminders',
        to: `${parentIds.size} ${parentIds.size === 1 ? 'parent' : 'parents'} with a pledge`,
        subject: `UN Day is this morning, ${longDate(event)}`,
        body: [`UN Day is this morning, ${longDate(event)}. Please bring what you pledged.`, '', parentBody].join('\n'),
      },
      {
        id: 'stall_update',
        title: 'Daily update to each stall',
        toggle: 'daily_stall_update',
        to: 'The lead and food coordinator on each stall',
        subject: 'UN Day pledges so far',
        body: stallBlocks.map((block) => (
          `${block.text}\n\nTo: ${block.to.length ? block.to.join(', ') : 'No email on this stall yet'}`
        )).join('\n\n---\n\n'),
      },
      {
        id: 'admin_report',
        title: 'Daily report to the PTC',
        toggle: 'daily_admin_report',
        to: (admins || []).map((person) => person.email).filter(Boolean).join(', ') || 'PTC admins',
        subject: `UN Day daily report, ${longDate(colomboDay(now))}`,
        body: ['All stalls', '', ...short, '', 'A CSV of every active pledge is attached.', '', reportCsv.replace(/^\uFEFF/, '').split('\r\n').slice(0, 4).join('\n')].join('\n'),
        attachment: 'un-day-2026-pledges.csv',
      },
      {
        id: 'progress_report',
        title: 'Progress note',
        toggle: 'progress_report',
        to: recipients.length ? recipients.join(', ') : 'No addresses yet',
        subject: 'UN Day progress',
        body: progressBody,
        schedule: config.progress_schedule,
      },
    ],
    csvPreview: csv,
    stallsWithPledges: stallsShort.length,
  }
}
