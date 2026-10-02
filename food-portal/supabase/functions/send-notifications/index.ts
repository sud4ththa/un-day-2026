// Sends UN Day emails through Resend when an admin has turned that message on.
// A test send goes only to the signed-in PTC admin. The demo never calls this.
//
// Secrets: RESEND_API_KEY, NOTIFY_FROM, NOTIFY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Schedule: see food-portal/README.md. Sends stay off until the toggles are on.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  const body = await request.json().catch(() => ({}))
  const mode = body.mode === 'test' ? 'test' : 'scheduled'
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const resendKey = Deno.env.get('RESEND_API_KEY') || ''
  const from = Deno.env.get('NOTIFY_FROM') || ''
  const secret = Deno.env.get('NOTIFY_SECRET') || ''

  if (!supabaseUrl || !serviceKey) {
    return json({ sent: false, reason: 'Email is not connected yet.' }, 200)
  }

  if (mode === 'scheduled' && (!secret || request.headers.get('x-notify-secret') !== secret)) {
    return json({ sent: false, reason: 'Not allowed.' }, 401)
  }

  let testEmail = ''
  if (mode === 'test') {
    const auth = request.headers.get('Authorization') || ''
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: serviceKey },
    })
    if (!userRes.ok) return json({ sent: false, reason: 'Sign in again.' }, 401)
    const user = await userRes.json()
    testEmail = String(user.email || '').toLowerCase()
    const allowed = await rest(
      supabaseUrl,
      serviceKey,
      `allowlist?email=eq.${encodeURIComponent(testEmail)}&role=eq.admin&select=email`,
    )
    if (!Array.isArray(allowed) || allowed.length === 0) {
      return json({ sent: false, reason: 'Only a PTC admin can send a test.' }, 403)
    }
  }

  const settingsRows = await rest(supabaseUrl, serviceKey, 'notification_settings?id=eq.portal&select=*')
  const settings = settingsRows?.[0] || {}
  const kind = String(body.kind || '')
  const due = mode === 'scheduled' ? scheduledKinds(settings) : [kind]
  if (!due.length || !due[0]) {
    return json({ sent: false, reason: 'Nothing is switched on.' }, 200)
  }

  if (!resendKey || !from) {
    return json({ sent: false, reason: 'Email is not connected yet.' }, 200)
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date())
  const event = String(settings.event_date || '2026-10-16').slice(0, 10)
  const wanted = mode === 'test'
    ? [kind]
    : due.filter((item) => messageIsDue(item, settings, today, event))
  if (!wanted.length || !wanted[0]) {
    return json({ sent: false, reason: 'Nothing is due today.' }, 200)
  }

  const sent = []
  if (mode === 'test') {
    const text = await messageText(supabaseUrl, serviceKey, kind, settings)
    const result = await sendResend(resendKey, from, testEmail, subjectFor(kind), `${text}\n\nThis is a test sent only to you.\n`)
    if (!result.ok) return json({ sent: false, reason: 'The email service refused the test.' }, 200)
    sent.push(kind)
  } else {
    for (const item of wanted) {
      const text = await messageText(supabaseUrl, serviceKey, item, settings)
      const recipients = await recipientsFor(supabaseUrl, serviceKey, item, settings)
      for (const email of recipients) {
        const result = await sendResend(resendKey, from, email, subjectFor(item), text)
        if (result.ok) sent.push(`${item}:${email}`)
      }
    }
  }

  return json({ sent: sent.length > 0, count: sent.length }, 200)
})

function messageIsDue(kind, settings, today, event) {
  const eve = shiftDay(event, -1)
  if (kind === 'parent_eve') return today === eve
  if (kind === 'parent_morning') return today === event
  if (kind === 'progress_report' && settings.progress_schedule !== 'daily') {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Colombo', weekday: 'short' }).format(new Date())
    return weekday === 'Mon'
  }
  return true
}

function shiftDay(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function messageText(url, key, kind, settings) {
  const stalls = await rest(url, key, 'stalls?select=id,name,assigned_year_group&order=sort_order') || []
  const dishes = await rest(url, key, 'dishes?select=id,stall_id,name,max_quantity,target_pieces') || []
  const pledges = await rest(url, key, 'pledges?status=eq.active&select=stall_id,dish_id,quantity,money_lkr,kind,created_at') || []
  const lines = stalls.map((stall) => {
    const menu = dishes.filter((dish) => dish.stall_id === stall.id && String(dish.name || '').trim())
    const bits = menu.map((dish) => {
      const cap = dish.max_quantity ?? dish.target_pieces
      const pledged = pledges
        .filter((pledge) => pledge.dish_id === dish.id && pledge.kind === 'food')
        .reduce((sum, pledge) => sum + Number(pledge.quantity || 0), 0)
      if (cap == null) return `${dish.name} · ${pledged} pledged`
      const still = Math.max(0, Number(cap) - pledged)
      return `${dish.name} · ${pledged} of ${cap} · ${still} still needed`
    })
    return `${stall.name}\n${bits.length ? bits.join('\n') : 'No dishes yet'}`
  })
  if (kind === 'progress_report') {
    const families = new Set(pledges.map((pledge) => pledge.stall_id)).size
    return `UN Day 2026\n\nFood plans for ${settings.event_date || '2026-10-16'}.\n${families} stalls have pledges.\n\nThis is a short progress note for the Principal and the Parent Collective.\n\nThe PTC\n`
  }
  if (kind === 'parent_eve' || kind === 'parent_morning') {
    const when = kind === 'parent_eve'
      ? 'UN Day is tomorrow.'
      : 'UN Day is this morning. Please bring what you pledged.'
    return `${when}\n\nThe PTC\n`
  }
  if (kind === 'stall_update') {
    return `Pledges so far\n\n${lines.join('\n\n')}\n\nThe PTC\n`
  }
  return `All stalls\n\n${lines.join('\n\n')}\n\nA CSV of the pledges is prepared with this report.\n\nThe PTC\n`
}

function scheduledKinds(settings) {
  const kinds = []
  if (settings.parent_reminders) {
    kinds.push('parent_eve', 'parent_morning')
  }
  if (settings.daily_stall_update) kinds.push('stall_update')
  if (settings.daily_admin_report) kinds.push('admin_report')
  if (settings.progress_report) kinds.push('progress_report')
  return kinds
}

function subjectFor(kind) {
  if (kind === 'parent_eve') return 'UN Day food tomorrow'
  if (kind === 'parent_morning') return 'UN Day is this morning'
  if (kind === 'stall_update') return 'UN Day pledges so far'
  if (kind === 'admin_report') return 'UN Day daily report'
  return 'UN Day progress'
}

async function recipientsFor(url, key, kind, settings) {
  if (kind === 'parent_eve' || kind === 'parent_morning') {
    const parents = await rest(url, key, 'parents?select=email')
    return (parents || []).map((row) => row.email).filter(Boolean)
  }
  if (kind === 'stall_update') {
    const contacts = await rest(url, key, 'stall_contacts?select=email')
    return (contacts || []).map((row) => row.email).filter(Boolean)
  }
  if (kind === 'admin_report') {
    const admins = await rest(url, key, 'allowlist?role=eq.admin&select=email')
    return (admins || []).map((row) => row.email).filter(Boolean)
  }
  return String(settings.progress_recipients || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.includes('@'))
}

async function rest(url, key, path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  })
  if (!response.ok) return []
  return response.json()
}

async function sendResend(key, from, to, subject, text) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  })
  return { ok: response.ok }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
