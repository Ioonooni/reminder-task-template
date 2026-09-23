import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-scheduler-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function envKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS', fallback: string) {
  const raw = Deno.env.get(name)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed.default) return parsed.default as string
  }
  const value = Deno.env.get(fallback)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function positionLabel(position: string) {
  if (position === 'LEFT') return 'ตะแคงซ้าย'
  if (position === 'RIGHT') return 'ตะแคงขวา'
  return 'นอนหงาย'
}

async function createClients(authorization?: string) {
  const url = Deno.env.get('SUPABASE_URL')!
  const publishable = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const user = authorization ? createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } }
  }) : null
  return { admin, user }
}

async function loadVapid(admin: ReturnType<typeof createClient>) {
  const [{ data: publicKey, error: pubError }, { data: privateKey, error: privError }] = await Promise.all([
    admin.rpc('get_vapid_public_key_for_backend'),
    admin.rpc('get_vapid_private_key_for_backend')
  ])
  if (pubError || privError || !publicKey || !privateKey) {
    throw pubError ?? privError ?? new Error('VAPID keys unavailable')
  }
  webpush.setVapidDetails('https://github.com/Ioonooni/reminder-task-template', publicKey, privateKey)
}

async function dispatchReminder(
  admin: ReturnType<typeof createClient>,
  row: { reminder_id: string; reminder_user_id: string; reminder_position: string; reminder_scheduled_at: string },
  kind: 'initial' | 'followup'
) {
  const { data: subscriptions, error: subError } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,public_key,auth_key')
    .eq('user_id', row.reminder_user_id)
    .eq('active', true)
  if (subError) throw subError

  let sent = 0
  let lastError: string | null = null
  const payload = JSON.stringify({
    title: kind === 'initial' ? 'ถึงเวลาพลิกตะแคงตัว' : 'เตือนอีกครั้ง: ยังไม่ได้กดเสร็จแล้ว',
    body: kind === 'initial'
      ? `ท่าที่กำหนด: ${positionLabel(row.reminder_position)}`
      : `กรุณาตรวจสอบและกดเสร็จแล้วเมื่อดำเนินการเรียบร้อย • ${positionLabel(row.reminder_position)}`,
    tag: `reminder-${row.reminder_id}-${kind}`,
    url: `/?reminder=${row.reminder_id}`
  })

  for (const sub of subscriptions ?? []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.public_key, auth: sub.auth_key }
      }, payload, { TTL: 300 })
      sent += 1
    } catch (cause) {
      const statusCode = Number((cause as { statusCode?: number }).statusCode ?? 0)
      lastError = statusCode ? `push_${statusCode}` : 'push_failed'
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions')
          .update({ active: false, last_seen_at: new Date().toISOString() })
          .eq('id', sub.id)
      }
    }
  }

  const { error: finalizeError } = await admin.rpc('finalize_reminder_dispatch_v1p4', {
    p_reminder_id: row.reminder_id,
    p_kind: kind,
    p_sent_count: sent,
    p_error: lastError,
    p_now: new Date().toISOString()
  })
  if (finalizeError) throw finalizeError
  return { sent, lastError }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: cors })

  try {
    const body = await req.json().catch(() => ({}))
    const action = body?.action ?? 'tick'
    const authorization = req.headers.get('Authorization') ?? ''
    const { admin, user } = await createClients(authorization || undefined)

    if (action === 'complete') {
      const token = authorization.replace(/^Bearer\s+/i, '')
      if (!token || !user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors })
      const { data: { user: authUser }, error: userError } = await user.auth.getUser(token)
      if (userError || !authUser) return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors })
      const reminderId = String(body?.reminder_id ?? '')
      if (!reminderId) return Response.json({ error: 'missing_reminder_id' }, { status: 400, headers: cors })

      const { data, error } = await admin.rpc('complete_reminder_v1p4', {
        p_reminder_id: reminderId,
        p_user_id: authUser.id,
        p_now: new Date().toISOString()
      })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      return Response.json(result ?? { result: 'not_found' }, { headers: cors })
    }

    if (action !== 'tick') return Response.json({ error: 'invalid_action' }, { status: 400, headers: cors })

    const schedulerSecret = req.headers.get('x-scheduler-secret') ?? ''
    const { data: expectedSecret, error: secretError } = await admin.rpc('get_v1p4_scheduler_secret_for_backend')
    if (secretError || !expectedSecret || schedulerSecret !== expectedSecret) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors })
    }

    await loadVapid(admin)
    const now = new Date().toISOString()
    const [{ data: initial, error: initialError }, { data: followups, error: followupError }] = await Promise.all([
      admin.rpc('claim_due_initial_reminders_v1p4', { p_now: now }),
      admin.rpc('claim_due_followup_reminders_v1p4', { p_now: now })
    ])
    if (initialError || followupError) throw initialError ?? followupError

    let initialSent = 0
    let followupSent = 0

    for (const row of initial ?? []) {
      const result = await dispatchReminder(admin, row, 'initial')
      initialSent += result.sent
    }

    for (const row of followups ?? []) {
      const { data: latest } = await admin.from('reminder_instances')
        .select('completed_at')
        .eq('id', row.reminder_id)
        .single()
      if (latest?.completed_at) continue
      const result = await dispatchReminder(admin, row, 'followup')
      followupSent += result.sent
    }

    return Response.json({
      ok: true,
      initial_claimed: (initial ?? []).length,
      followup_claimed: (followups ?? []).length,
      initial_sent: initialSent,
      followup_sent: followupSent
    }, { headers: cors })
  } catch (cause) {
    console.error(cause)
    return Response.json({ error: 'reminder_engine_failed' }, { status: 500, headers: cors })
  }
})
